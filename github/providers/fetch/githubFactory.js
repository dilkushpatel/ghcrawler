// Copyright (c) Microsoft Corporation. All rights reserved.
// SPDX-License-Identifier: MIT

const requestor = require('ghrequestor');
const ComputeLimiter = require('./computeLimiter');
const LimitedTokenFactory = require('./limitedTokenFactory');
const TokenFactory = require('./tokenFactory');
const Crawler = require('../../../');

function createComputeLimiter(options) {
  options.logger.info('create compute limiter', { computeLimitStore: options.computeLimitStore });
  const limiter = options.computeLimitStore === 'redis'
    ? createRedisComputeLimiter(Crawler.getProvider('redis'), options)
    : createInMemoryComputeLimiter(options);
  options.baselineUpdater = networkBaselineUpdater.bind(null, options.logger);
  return new ComputeLimiter(limiter, options);
}

function createRedisComputeLimiter(redisClient, options) {
  const address = ip.address().toString();
  options.logger.info('create redis compute limiter', { address: address, computeWindow: options.computeWindow, computeLimit: options.computeLimit });
  return RedisRateLimiter.create({
    redis: redisClient,
    key: request => `${address}:compute:${request.key}`,
    incr: request => request.amount,
    window: () => options.computeWindow || 15,
    limit: () => options.computeLimit || 15000
  });
}

function createInMemoryComputeLimiter(options) {
  options.logger.info('create in memory compute limiter', { computeWindow: options.computeWindow, computeLimit: options.computeLimit });
  return InMemoryRateLimiter.create({
    key: request => 'compute:' + request.key,
    incr: request => request.amount,
    window: () => options.computeWindow || 15,
    limit: () => options.computeLimit || 15000
  });
}

function networkBaselineUpdater(logger) {
  return Q.allSettled([0, 1, 2, 3].map(number => {
    return Q.delay(number * 50).then(() => {
      const deferred = Q.defer();
      request({
        url: 'https://api.github.com/rate_limit',
        headers: {
          'User-Agent': 'ghrequestor'
        },
        time: true
      }, (error, response, body) => {
        if (error) {
          return deferred.reject(error);
        }
        deferred.resolve(response.elapsedTime);
      });
      return deferred.promise;
    });
  })).then(times => {
    let total = 0;
    let count = 0;
    for (let index in times) {
      if (times[index].state === 'fulfilled') {
        total += times[index].value;
        count++;
      }
    }
    const result = Math.floor(total / count);
    logger.info(`New GitHub request baseline: ${result}`);
    return result;
  });
}

function createRequestor(options) {
  options.logger.info('create requestor');
  return requestor.defaults({
    // turn off the requestor's throttle management mechanism in favor of ours
    forbiddenDelay: 0,
    delayOnThrottle: false
  });
}

function createTokenFactory(options) {
  options.logger.info('create token factory');
  const factory = new TokenFactory(config.get('CRAWLER_GITHUB_TOKENS'), options);
  const limiter = Crawler.createTokenLimiter(options);
  return new LimitedTokenFactory(factory, limiter, options);
}

module.exports = (options, store) => {
  const requestor = createRequestor();
  const tokenFactory = createTokenFactory(options);
  const limiter = Crawler.createComputeLimiter(options);
  return new GitHubFetcher(requestor, store, tokenFactory, limiter, options);
};


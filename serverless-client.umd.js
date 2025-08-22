(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.ServerlessClient = {}));
})(this, function(exports2) {
  "use strict";
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
  }
  var PollRequestManager_1;
  var hasRequiredPollRequestManager;
  function requirePollRequestManager() {
    if (hasRequiredPollRequestManager) return PollRequestManager_1;
    hasRequiredPollRequestManager = 1;
    function PollRequestManager(fetchFunction, connectionTimeout = 1e4) {
      const requests = /* @__PURE__ */ new Map();
      function Request(url, options, delay = 0) {
        let promiseHandlers = {};
        let currentState = void 0;
        let timeout;
        this.url = url;
        let abortController;
        let previousAbortController;
        this.execute = function() {
          if (typeof AbortController !== "undefined") {
            if (typeof abortController === "undefined") {
              previousAbortController = new AbortController();
            } else {
              previousAbortController = abortController;
            }
            abortController = new AbortController();
            options.signal = previousAbortController.signal;
          }
          if (!currentState && delay) {
            currentState = new Promise((resolve, reject) => {
              timeout = setTimeout(() => {
                fetchFunction(url, options).then((response) => {
                  resolve(response);
                }).catch((err) => {
                  reject(err);
                });
              }, delay);
            });
          } else {
            currentState = fetchFunction(url, options);
          }
          return currentState;
        };
        this.cancelExecution = function() {
          clearTimeout(timeout);
          timeout = void 0;
          if (typeof currentState !== "undefined") {
            currentState = void 0;
          }
          promiseHandlers.resolve = (...args) => {
            console.log("(not important) Resolve called after cancel execution with the following args", ...args);
          };
          promiseHandlers.reject = (...args) => {
            console.log("(not important) Reject called after cancel execution with the following args", ...args);
          };
        };
        this.setExecutor = function(resolve, reject) {
          if (promiseHandlers.resolve) {
            return reject(new Error("Request already in progress"));
          }
          promiseHandlers.resolve = resolve;
          promiseHandlers.reject = reject;
        };
        this.resolve = function(...args) {
          promiseHandlers.resolve(...args);
          this.destroy();
          promiseHandlers = {};
        };
        this.reject = function(...args) {
          if (promiseHandlers.reject) {
            promiseHandlers.reject(...args);
          }
          this.destroy();
          promiseHandlers = {};
        };
        this.destroy = function(removeFromPool = true) {
          this.cancelExecution();
          if (!removeFromPool) {
            return;
          }
          const requestsEntries = requests.entries();
          let identifier;
          for (const [key, value] of requestsEntries) {
            if (value === this) {
              identifier = key;
              break;
            }
          }
          if (identifier) {
            requests.delete(identifier);
          }
        };
        this.abort = () => {
          if (typeof previousAbortController !== "undefined") {
            previousAbortController.abort();
          }
        };
      }
      this.createRequest = function(url, options, delayedStart = 0) {
        const request = new Request(url, options, delayedStart);
        const promise = new Promise((resolve, reject) => {
          request.setExecutor(resolve, reject);
          createPollingTask(request);
        });
        promise.abort = () => {
          this.cancelRequest(promise);
        };
        requests.set(promise, request);
        return promise;
      };
      this.cancelRequest = function(promiseOfRequest) {
        if (typeof promiseOfRequest === "undefined") {
          console.log("No active request found.");
          return;
        }
        const request = requests.get(promiseOfRequest);
        if (request) {
          request.destroy(false);
          requests.delete(promiseOfRequest);
        }
      };
      this.setConnectionTimeout = (_connectionTimeout) => {
        connectionTimeout = _connectionTimeout;
      };
      function createPollingTask(request) {
        let safePeriodTimeoutHandler;
        let serverResponded = false;
        function beginSafePeriod() {
          safePeriodTimeoutHandler = setTimeout(() => {
            if (!serverResponded) {
              request.abort();
            }
            serverResponded = false;
            beginSafePeriod();
          }, connectionTimeout * 2);
          reArm();
        }
        function endSafePeriod(serverHasResponded) {
          serverResponded = serverHasResponded;
          clearTimeout(safePeriodTimeoutHandler);
        }
        function reArm() {
          request.execute().then((response) => {
            if (!response.ok) {
              endSafePeriod(true);
              if (response.status === 403) {
                request.reject(Error("Token expired"));
                return;
              }
              if (response.status === 503) {
                let err = Error(response.statusText || "Service unavailable");
                err.code = 503;
                throw err;
              }
              return beginSafePeriod();
            }
            if (response.status === 204) {
              endSafePeriod(true);
              beginSafePeriod();
              return;
            }
            if (safePeriodTimeoutHandler) {
              clearTimeout(safePeriodTimeoutHandler);
            }
            request.resolve(response);
          }).catch((err) => {
            switch (err.code) {
              case "ETIMEDOUT":
              case "ECONNREFUSED":
                endSafePeriod(true);
                beginSafePeriod();
                break;
              case 20:
              case "ERR_NETWORK_IO_SUSPENDED":
              case "ERR_INTERNET_DISCONNECTED":
                break;
              default:
                console.log("abnormal error: ", err);
                endSafePeriod(true);
                request.reject(err);
            }
          });
        }
        beginSafePeriod();
      }
    }
    PollRequestManager_1 = PollRequestManager;
    return PollRequestManager_1;
  }
  function NotificationManager$1(webhookUrl, pollTimeout = 3e4, pollInterval = 1e3, infinite = false, maxAttempts = 30) {
    const PollRequestManager = requirePollRequestManager();
    const polling = /* @__PURE__ */ new Map();
    const pollManager = new PollRequestManager(fetch, pollTimeout);
    this.waitForResult = (callId, options = {}) => {
      const {
        onProgress = void 0,
        onEnd = void 0,
        onError = void 0,
        maxAttempts: maxAttempts2,
        infinite: infinite2
      } = options;
      if (polling.has(callId)) {
        return polling.get(callId).promise;
      }
      let attempts = 0;
      let consecutiveFailures = 0;
      const startTime = Date.now();
      const MAX_CONSECUTIVE_FAILURES = 5;
      const promise = new Promise((resolve, reject) => {
        const longPoll = async () => {
          attempts++;
          const attemptsDisplay = infinite2 ? `${attempts}/infinite` : `${attempts}/${maxAttempts2}`;
          console.log(`Long polling for result of call ${callId} (attempt ${attemptsDisplay}, consecutive failures: ${consecutiveFailures})`);
          try {
            const pollPromise = pollManager.createRequest(`${webhookUrl}/${callId}`, {
              method: "GET",
              headers: {
                "Content-Type": "application/json"
              }
            });
            const pollingItem = polling.get(callId);
            if (pollingItem) {
              pollingItem.currentPollPromise = pollPromise;
            }
            const response = await pollPromise;
            if (!response.ok) {
              consecutiveFailures++;
              console.error(`Webhook long polling error: ${response.status} ${response.statusText} (consecutive failures: ${consecutiveFailures})`);
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                const serverDownError = new Error(`Server appears to be down: ${consecutiveFailures} consecutive failures. Last status: ${response.status}`);
                serverDownError.code = "SERVER_DOWN";
                serverDownError.callId = callId;
                serverDownError.consecutiveFailures = consecutiveFailures;
                polling.delete(callId);
                if (onError) {
                  onError(serverDownError);
                }
                reject(serverDownError);
                return;
              }
              if (!infinite2 && attempts >= maxAttempts2) {
                polling.delete(callId);
                const timeoutError = new Error(`Webhook long polling failed with status ${response.status} after ${attempts} attempts`);
                timeoutError.code = "POLLING_TIMEOUT";
                timeoutError.callId = callId;
                if (onError) {
                  onError(timeoutError);
                }
                reject(timeoutError);
                return;
              }
              setTimeout(() => longPoll(), pollInterval);
              return;
            }
            consecutiveFailures = 0;
            const data = await response.json();
            console.log(`Long poll response for ${callId}:`, JSON.stringify(data));
            if (data.status === "error") {
              const webhookError = new Error(data.message || "Webhook reported an error");
              webhookError.code = data.code || "WEBHOOK_ERROR";
              webhookError.callId = callId;
              webhookError.details = data.details;
              polling.delete(callId);
              if (onError) {
                onError(webhookError);
              }
              reject(webhookError);
              return;
            }
            if (data.status === "completed") {
              const pollingItem2 = polling.get(callId);
              const responseTime = Date.now() - pollingItem2.startTime;
              console.log(`Completed: ${callId} (${responseTime}ms)`);
              if (data.progress && onProgress) {
                onProgress(data.progress);
              }
              polling.delete(callId);
              if (onEnd) {
                onEnd(data.result);
              }
              resolve(data.result);
            } else if (data.status === "pending") {
              const pollingItem2 = polling.get(callId);
              const pollingTime = Date.now() - pollingItem2.startTime;
              if (data.progress && onProgress) {
                console.log(`Progress: ${callId} (${pollingTime}ms)`);
                onProgress(data.progress);
              } else {
                console.log(`Timeout: ${callId} (${pollingTime}ms) - reconnecting`);
              }
              if (!infinite2 && attempts >= maxAttempts2) {
                const timeoutError = new Error(`Timeout waiting for result for call ${callId}`);
                timeoutError.code = "POLLING_TIMEOUT";
                timeoutError.callId = callId;
                polling.delete(callId);
                if (onError) {
                  onError(timeoutError);
                }
                reject(timeoutError);
                return;
              }
              setTimeout(() => longPoll(), 0);
            } else if (data.status === "expired") {
              const expiredError = new Error(`Call ${callId} expired on the server`);
              expiredError.code = "PROCESS_UNAVAILABLE";
              expiredError.callId = callId;
              polling.delete(callId);
              if (onError) {
                onError(expiredError);
              }
              reject(expiredError);
              return;
            }
          } catch (error) {
            if (error.name === "AbortError") {
              console.log(`Long polling aborted for call ${callId}`);
              return;
            }
            consecutiveFailures++;
            console.error(`Long polling error for call ${callId}:`, error, `(consecutive failures: ${consecutiveFailures})`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              const persistentError = new Error(`Persistent polling failures: ${error.message}. ${consecutiveFailures} consecutive attempts failed.`);
              persistentError.code = "PERSISTENT_FAILURE";
              persistentError.callId = callId;
              persistentError.consecutiveFailures = consecutiveFailures;
              persistentError.originalError = error;
              polling.delete(callId);
              if (onError) {
                onError(persistentError);
              }
              reject(persistentError);
              return;
            }
            if (!infinite2 && attempts >= maxAttempts2) {
              polling.delete(callId);
              const finalError = new Error(`Polling failed after ${attempts} attempts: ${error.message}`);
              finalError.code = "POLLING_FAILED";
              finalError.callId = callId;
              finalError.originalError = error;
              if (onError) {
                onError(finalError);
              }
              reject(finalError);
              return;
            }
            setTimeout(() => longPoll(), pollInterval);
          }
        };
        longPoll();
      });
      polling.set(callId, {
        promise,
        startTime,
        attempts: 0,
        currentPollPromise: null
      });
      return promise;
    };
    this.cancelPolling = (callId) => {
      const pollingItem = polling.get(callId);
      if (pollingItem) {
        if (pollingItem.currentPollPromise) {
          pollManager.cancelRequest(pollingItem.currentPollPromise);
        }
        polling.delete(callId);
      }
    };
    this.cancelAll = () => {
      for (const [callId, pollingItem] of polling.entries()) {
        if (pollingItem.currentPollPromise) {
          pollManager.cancelRequest(pollingItem.currentPollPromise);
        }
      }
      polling.clear();
    };
    this.setConnectionTimeout = (timeout) => {
      pollManager.setConnectionTimeout(timeout);
    };
  }
  var NotificationManager_1 = NotificationManager$1;
  const NotificationManager = NotificationManager_1;
  function LambdaClientResponse$1(webhookUrl, initialCallId, operationType) {
    let progressCallback = null;
    let endCallback = null;
    let errorCallback = null;
    let callId = initialCallId;
    let currentOperationType = operationType;
    const notificationManager = new NotificationManager(webhookUrl);
    let resolvePromise, rejectPromise;
    let isResolved = false;
    this.result = null;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = (value) => {
        if (!isResolved) {
          isResolved = true;
          resolve(value);
        }
      };
      rejectPromise = (error) => {
        if (!isResolved) {
          isResolved = true;
          if (errorCallback) {
            try {
              errorCallback(error);
            } catch (callbackError) {
              console.error("Error in error callback:", callbackError);
            }
          }
          reject(error);
        }
      };
    });
    this._updateOperationType = (newType) => {
      console.log(`LambdaClientResponse: Updating operation type from ${currentOperationType} to ${newType}`);
      currentOperationType = newType;
    };
    this._isLongRunningOperation = (operationType2) => {
      const longRunningOperations = [
        "slowLambda",
        "observableLambda",
        "cmbSlowLambda",
        "cmbObservableLambda"
      ];
      return longRunningOperations.includes(operationType2);
    };
    this._setCallId = (newCallId) => {
      console.log(`LambdaClientResponse: Setting callId to ${newCallId}`);
      callId = newCallId;
      if (this._isLongRunningOperation(currentOperationType)) {
        const wrapper = {
          onProgress: (callback) => {
            progressCallback = callback;
            return wrapper;
          },
          onEnd: (callback) => {
            endCallback = callback;
            return wrapper;
          },
          onError: (callback) => {
            errorCallback = callback;
            return wrapper;
          },
          result: null
        };
        this._wrapper = wrapper;
        resolvePromise(wrapper);
        setTimeout(() => {
          this._startPolling();
        }, 1);
      } else {
        this._startPolling();
      }
    };
    this._startPolling = () => {
      notificationManager.waitForResult(callId, {
        onProgress: (progress) => {
          if (progressCallback) {
            progressCallback(progress);
          }
        },
        onEnd: (result) => {
          if (this._isLongRunningOperation(currentOperationType) && endCallback) {
            endCallback(result);
          }
        },
        onError: (error) => {
          if (errorCallback) {
            errorCallback(error);
          }
        },
        infinite: this.infinite !== void 0 ? this.infinite : this._isLongRunningOperation(currentOperationType),
        maxAttempts: this.maxAttempts !== void 0 ? this.maxAttempts : this._isLongRunningOperation(currentOperationType) ? Infinity : 30
      }).then((result) => {
        this.result = result;
        if (this._wrapper) {
          this._wrapper.result = result;
        }
        if (!this._isLongRunningOperation(currentOperationType)) {
          resolvePromise(result);
        }
      }).catch((error) => {
        notificationManager.cancelPolling(callId);
        rejectPromise(error);
      }).finally(() => {
        notificationManager.cancelAll();
      });
    };
    this._resolve = (result) => {
      this.result = result;
      if (!this._isLongRunningOperation(currentOperationType)) {
        resolvePromise(result);
      }
    };
    this._reject = rejectPromise;
    this.setTimeout = (duration) => {
      return this;
    };
    this.setInfinite = (infinite = true) => {
      this.infinite = infinite;
      return this;
    };
    this.setMaxAttempts = (maxAttempts) => {
      this.maxAttempts = maxAttempts;
      return this;
    };
    this.onProgress = (callback) => {
      progressCallback = callback;
      return this;
    };
    this.onEnd = (callback) => {
      endCallback = callback;
      return this;
    };
    this.onError = (callback) => {
      errorCallback = callback;
      return this;
    };
    this.then = function(onFulfilled, onRejected) {
      return promise.then(onFulfilled, onRejected);
    };
    this.catch = function(onRejected) {
      return promise.catch(onRejected);
    };
    this.finally = function(onFinally) {
      return promise.finally(onFinally);
    };
  }
  var LambdaClientResponse_1 = LambdaClientResponse$1;
  function PendingCallMixin$2(target) {
    let pendingCalls = [];
    let serialPendingCalls = [];
    let isSerialExecutionReady = false;
    let isExecutionReady = false;
    target.addPendingCall = (pendingFn) => {
      if (isExecutionReady) {
        pendingFn();
      } else {
        pendingCalls.push(pendingFn);
      }
    };
    target.executePendingCalls = () => {
      isExecutionReady = true;
      pendingCalls.forEach((fn) => fn());
      pendingCalls = [];
    };
    target.addSerialPendingCall = (pendingFn) => {
      serialPendingCalls.push(pendingFn);
      if (isSerialExecutionReady) {
        next();
      }
    };
    function next() {
      const fn = serialPendingCalls.shift();
      if (typeof fn !== "undefined") {
        try {
          fn(function() {
            setTimeout(() => {
              next();
            }, 0);
          });
        } catch (e) {
          console.log(e);
        }
      }
    }
    target.executeSerialPendingCalls = () => {
      isSerialExecutionReady = true;
      next();
    };
  }
  var PendingCallMixin_1 = PendingCallMixin$2;
  const LambdaClientResponse = LambdaClientResponse_1;
  const PendingCallMixin$1 = PendingCallMixin_1;
  function ServerlessClient$1(userId, endpoint, serverlessId, pluginName, options = {}) {
    if (!endpoint) {
      throw new Error("Endpoint URL is required");
    }
    const baseEndpoint = `${endpoint}/proxy`;
    const webhookUrl = `${endpoint}/internalWebhook`;
    const commandEndpoint = `${baseEndpoint}/executeCommand/${serverlessId}`;
    let isServerReady = false;
    PendingCallMixin$1(this);
    const waitForServerReady = async (endpoint2, serverlessId2, maxAttempts = 30) => {
      const readyEndpoint = `${endpoint2}/proxy/ready/${serverlessId2}`;
      const interval = 1e3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(readyEndpoint);
          if (response.ok) {
            const data = await response.json();
            if (data.result && data.result.status === "ready") {
              isServerReady = true;
              this.executePendingCalls();
              return true;
            }
          }
        } catch (error) {
          console.log(`Attempt ${attempt}/${maxAttempts}: Server not ready yet...`);
        }
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, interval));
        }
      }
      throw new Error("Server failed to become ready within the specified timeout");
    };
    const __executeCommand = (commandName, args) => {
      args = args || [];
      const command = {
        forWhom: userId,
        name: commandName,
        pluginName,
        args,
        serverlessId,
        options
      };
      const clientResponse = new LambdaClientResponse(webhookUrl, null, "sync");
      let headers = {};
      if (options.sessionId) {
        headers = {
          "Cookie": `sessionId=${options.sessionId}`
        };
      }
      const executeRequest = () => {
        fetch(commandEndpoint, {
          method: "PUT",
          headers,
          body: JSON.stringify(command)
        }).then((response) => {
          return response.json().then((data) => {
            if (!response.ok) {
              if (data && data.result && typeof data.result === "object" && data.result.message) {
                const error = new Error(data.result.message);
                if (data.result.stack) {
                  error.stack = data.result.stack;
                }
                error.statusCode = data.statusCode || response.status;
                throw error;
              } else {
                const error = new Error(`HTTP error! status: ${response.status}`);
                error.statusCode = response.status;
                throw error;
              }
            }
            return data;
          });
        }).then((res) => {
          if (res.operationType === "restart") {
            isServerReady = false;
            this.addPendingCall(() => executeRequest());
            return;
          }
          if (!webhookUrl && (res.operationType === "slowLambda" || res.operationType === "observableLambda" || res.operationType === "cmbSlowLambda" || res.operationType === "cmbObservableLambda")) {
            throw new Error("Webhook URL is required for async operations");
          }
          if (res.operationType === "sync") {
            clientResponse._resolve(res.result);
          } else {
            clientResponse._updateOperationType(res.operationType);
            clientResponse._setCallId(res.result);
          }
        }).catch((error) => {
          clientResponse._reject(error);
        });
      };
      if (!isServerReady) {
        this.addPendingCall(() => executeRequest());
      } else {
        executeRequest();
      }
      return clientResponse;
    };
    const baseClient = {
      init: async function() {
        await waitForServerReady(endpoint, serverlessId);
        return this;
      }
    };
    return new Proxy(baseClient, {
      get(target, prop, receiver) {
        if (prop in target) {
          return target[prop];
        }
        if (prop === "then") {
          return void 0;
        }
        return (...args) => __executeCommand(prop, args);
      }
    });
  }
  var ServerlessClient_1 = ServerlessClient$1;
  function getBaseURL$1() {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "http://127.0.0.1:8080";
  }
  var getBaseURL_1 = getBaseURL$1;
  const ServerlessClient = ServerlessClient_1;
  const PendingCallMixin = PendingCallMixin_1;
  const getBaseURL = getBaseURL_1;
  async function createServerlessAPIClient(userId, endpoint, serverlessId, pluginName, webhookUrl, options) {
    const client = new ServerlessClient(userId, endpoint, serverlessId, pluginName, options);
    return await client.init();
  }
  var serverlessClient = {
    createServerlessAPIClient,
    PendingCallMixin,
    getBaseURL
  };
  const index = /* @__PURE__ */ getDefaultExportFromCjs(serverlessClient);
  exports2.default = index;
  Object.defineProperties(exports2, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
});

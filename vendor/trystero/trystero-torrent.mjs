/*! Trystero 0.26.0 (@trystero-p2p/torrent + @trystero-p2p/core), MIT License, Copyright (c) 2021 Dan Motzenbecker, https://github.com/dmotz/trystero */

// node_modules/@trystero-p2p/core/dist/utils.mjs
var { floor, min, sin } = Math;
var libName = "Trystero";
var alloc = (n, f) => Array(n).fill(void 0).map(f);
var charSet = "0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz";
var genId = (n) => alloc(n, () => charSet[floor(Math.random() * 62)] ?? "").join("");
var selfId = genId(20);
var all = Promise.all.bind(Promise);
var isBrowser = typeof window !== "undefined";
var { entries, fromEntries, keys, values } = Object;
var noOp = () => {
};
var candidateType = "candidate";
var resetTimer = (timer) => {
  if (timer !== null) clearTimeout(timer);
  return null;
};
var mkErr = (msg) => /* @__PURE__ */ new Error(`${libName}: ${msg}`);
var toErrorMessage = (reason, fallback) => {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return toJson(reason ?? fallback);
};
var toError = (reason, fallback) => reason instanceof Error ? reason : mkErr(toErrorMessage(reason, fallback));
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var encodeBytes = (txt) => encoder.encode(txt);
var decodeBytes = (buffer) => decoder.decode(buffer);
var toHex = (buffer) => buffer.reduce((a, c) => a + c.toString(16).padStart(2, "0"), "");
var topicPath = (...parts) => parts.join("@");
var shuffle = (xs, seed) => {
  const a = [...xs];
  const rand = () => {
    const x = sin(seed++) * 1e4;
    return x - floor(x);
  };
  let i = a.length;
  while (i) {
    const j = floor(rand() * i--);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
};
var getRelays = (config, defaults, defaultN, deriveFromAppId = false) => config.relayConfig?.urls || (deriveFromAppId ? shuffle(defaults, strToNum(config.appId)) : defaults).slice(0, config.relayConfig?.redundancy ?? defaultN);
var toJson = JSON.stringify;
var fromJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    throw mkErr(`failed to parse JSON: ${s}`);
  }
};
var strToNum = (str, limit = Number.MAX_SAFE_INTEGER) => str.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % limit;
var defaultRetryMs = 3333;
var maxRetryMs = 6e4;
var socketRetryPeriods = {};
var reconnectionLockingPromise = null;
var resolver = null;
var pauseRelayReconnection = () => {
  if (!reconnectionLockingPromise) reconnectionLockingPromise = new Promise((resolve) => {
    resolver = resolve;
  }).finally(() => {
    resolver = null;
    reconnectionLockingPromise = null;
  });
};
var resumeRelayReconnection = () => {
  resolver?.();
};
var makeSocket = (url, onMessage, onReconnect) => {
  const client = {};
  let didOpen = false;
  let isReconnectPending = false;
  let retryTimer;
  let resolveReady = noOp;
  client.isClosed = false;
  client.ready = new Promise((res) => resolveReady = res);
  const init = () => {
    if (client.isClosed) return;
    retryTimer = void 0;
    isReconnectPending = false;
    const socket = new WebSocket(url);
    socket.onclose = () => {
      if (client.isClosed || isReconnectPending) return;
      isReconnectPending = true;
      if (reconnectionLockingPromise) {
        reconnectionLockingPromise.then(init);
        return;
      }
      const period = socketRetryPeriods[url] ??= defaultRetryMs;
      retryTimer = setTimeout(init, Math.random() * period);
      socketRetryPeriods[url] = min(period * 2, maxRetryMs);
    };
    socket.onmessage = (e) => onMessage(String(e.data));
    client.socket = socket;
    client.url = socket.url;
    socket.onopen = () => {
      const isReconnect = didOpen;
      didOpen = true;
      resolveReady(client);
      socketRetryPeriods[url] = defaultRetryMs;
      if (isReconnect) onReconnect?.();
    };
    client.send = (data) => {
      if (socket.readyState === 1) socket.send(data);
    };
  };
  client.close = () => {
    client.isClosed = true;
    if (retryTimer !== void 0) {
      clearTimeout(retryTimer);
      retryTimer = void 0;
    }
    client.socket.close();
  };
  init();
  return client;
};
var createRelayManager = (getSocket) => {
  const relays = {};
  const keysByRelay = /* @__PURE__ */ new WeakMap();
  const keyOf = (relay) => {
    const key = keysByRelay.get(relay);
    if (!key) throw mkErr("relay bookkeeping missing registration for relay client");
    return key;
  };
  const scoped = () => {
    const store2 = {};
    const forKey = (key) => store2[key] ??= {};
    return {
      forKey,
      forRelay: (relay) => forKey(keyOf(relay))
    };
  };
  const store = (key, relay) => {
    relays[key] = relay;
    keysByRelay.set(relay, key);
    return relay;
  };
  return {
    register: (key, createRelay) => {
      const relay = relays[key];
      if (relay) return relay;
      return store(key, createRelay());
    },
    keyOf,
    scoped,
    getSockets: () => fromEntries(entries(relays).flatMap(([key, relay]) => {
      const socket = getSocket(relay);
      return socket ? [[key, socket]] : [];
    }))
  };
};
var watchOnline = () => {
  if (isBrowser) {
    const controller = new AbortController();
    addEventListener("online", resumeRelayReconnection, { signal: controller.signal });
    addEventListener("offline", pauseRelayReconnection, { signal: controller.signal });
    return () => controller.abort();
  }
  return noOp;
};

// node_modules/@trystero-p2p/core/dist/crypto.mjs
var algo = "AES-GCM";
var strToSha1 = {};
var pack = (buff) => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buff))));
var unpack = (packed) => {
  const str = atob(packed);
  return new Uint8Array(str.length).map((_, i) => str.charCodeAt(i)).buffer;
};
var hashWith = async (algorithm, str) => new Uint8Array(await crypto.subtle.digest(algorithm, encodeBytes(str)));
var sha1 = async (str) => strToSha1[str] ??= Array.from(await hashWith("SHA-1", str)).map((b) => b.toString(36)).join("");
var genKey = async (secret, appId, roomId) => crypto.subtle.importKey("raw", await crypto.subtle.digest({ name: "SHA-256" }, encodeBytes(`${secret}:${appId}:${roomId}`)), { name: algo }, false, ["encrypt", "decrypt"]);
var deriveRoomNamespace = async (appId, roomId) => toHex(await hashWith("SHA-256", `${libName}:${appId}:${roomId}`));
var joinChar = "$";
var ivJoinChar = ",";
var encrypt = async (keyP, plaintext) => {
  const iv = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
  return iv.join(ivJoinChar) + joinChar + pack(await crypto.subtle.encrypt({
    name: algo,
    iv
  }, await keyP, encodeBytes(plaintext)));
};
var decrypt = async (keyP, raw) => {
  const [iv, c] = raw.split(joinChar);
  return decodeBytes(await crypto.subtle.decrypt({
    name: algo,
    iv: new Uint8Array(iv?.split(ivJoinChar).map(Number) ?? [])
  }, await keyP, unpack(c ?? "")));
};

// node_modules/@trystero-p2p/core/dist/offer-manager.mjs
var offerLeaseTtlMs = 18e4;
var OfferManager = class {
  makeOffer;
  leased = /* @__PURE__ */ new Map();
  destroyed = false;
  constructor(makeOffer) {
    this.makeOffer = makeOffer;
  }
  claimLeased(peer) {
    const timer = this.leased.get(peer);
    if (timer) {
      resetTimer(timer);
      this.leased.delete(peer);
    }
  }
  reclaimLeased(peer) {
    if (this.leased.has(peer)) {
      this.claimLeased(peer);
      peer.destroy();
    }
  }
  checkout(n, leaseOffers, encryptOffer) {
    const toRecord = async (didRetry = false) => {
      if (this.destroyed) throw mkErr("room left while preparing offer");
      const peer = this.makeOffer();
      try {
        const offer2 = await encryptOffer(peer);
        if (this.destroyed) throw mkErr("room left while preparing offer");
        if (leaseOffers) {
          this.leased.set(peer, setTimeout(() => {
            this.leased.delete(peer);
            peer.destroy();
          }, offerLeaseTtlMs));
          return {
            peer,
            offer: offer2,
            claim: () => this.claimLeased(peer),
            reclaim: () => this.reclaimLeased(peer)
          };
        }
        return {
          peer,
          offer: offer2
        };
      } catch (error) {
        peer.destroy();
        if (!didRetry && !this.destroyed) return toRecord(true);
        throw error;
      }
    };
    return all(alloc(n, () => toRecord()));
  }
  getOffers(n, encryptOffer) {
    return this.checkout(n, true, encryptOffer);
  }
  destroy() {
    this.destroyed = true;
    this.leased.forEach((timer, peer) => {
      resetTimer(timer);
      peer.destroy();
    });
    this.leased.clear();
  }
};

// node_modules/@trystero-p2p/core/dist/handshake.mjs
var overlapRoomPasswordErr = mkErr("incorrect password for overlapping room");
var createPasswordHandshake = (password, appId, roomId) => {
  const hashChallenge = (challenge) => hashWith("SHA-256", `${challenge}:${password}:${appId}:${roomId}`).then(toHex);
  const run = async (send2, receive, isInitiator) => {
    if (!password) return;
    if (isInitiator) {
      const challenge = genId(36);
      await send2({
        __trystero_pw: "challenge",
        c: challenge
      });
      const { data: data2 } = await receive();
      if (!data2 || typeof data2 !== "object" || data2.__trystero_pw !== "response" || typeof data2.h !== "string") throw overlapRoomPasswordErr;
      const expected = await hashChallenge(challenge);
      if (data2.h !== expected) throw overlapRoomPasswordErr;
      return;
    }
    const { data } = await receive();
    if (!data || typeof data !== "object" || data.__trystero_pw !== "challenge" || typeof data.c !== "string") throw overlapRoomPasswordErr;
    await send2({
      __trystero_pw: "response",
      h: await hashChallenge(data.c)
    });
  };
  const compose = (userHandshake) => password || userHandshake ? async (peerId, send2, receive, isInitiator) => {
    await run(send2, receive, isInitiator);
    await userHandshake?.(peerId, send2, receive, isInitiator);
  } : void 0;
  return {
    run,
    compose
  };
};
var toHandshakeErrorMessage = (error) => {
  const message = toErrorMessage(error, "unknown error");
  return message.startsWith("handshake ") ? message : `handshake failed: ${message}`;
};
var createHandshakeManager = ({ onPeerHandshake, onHandshakeError, handshakeTimeoutMs, sendHandshakeData, sendHandshakeReady, onActivate, onFailure }) => {
  const peerStates = {};
  const maybeActivatePeer = (id, peer) => {
    const state = peerStates[id];
    if (!state || peer && state.peer !== peer || state.isActive) return;
    if (!state.didLocalHandshakePass || !state.didReceiveRemoteReady) return;
    state.isActive = true;
    state.handshakeTimer = resetTimer(state.handshakeTimer);
    onActivate(id, state.peer);
  };
  const failPeerHandshake = (id, peer, reason) => {
    const state = peerStates[id];
    if (!state || state.peer !== peer) return;
    const error = toHandshakeErrorMessage(reason);
    onHandshakeError?.(id, error);
    onFailure(id, peer, mkErr(error));
  };
  const markLocalHandshakePassed = (id, peer) => {
    const state = peerStates[id];
    if (!state || state.peer !== peer || state.isActive) return;
    state.didLocalHandshakePass = true;
    sendHandshakeReady("", id).catch((err) => failPeerHandshake(id, peer, mkErr(`failed sending handshake readiness: ${toErrorMessage(err, "unknown send failure")}`)));
    maybeActivatePeer(id, peer);
  };
  return {
    addPeer: (id, peer) => {
      peerStates[id] = {
        peer,
        isActive: false,
        didLocalHandshakePass: false,
        didReceiveRemoteReady: false,
        handshakeTimer: null,
        pendingHandshakePayloads: [],
        handshakeWaiters: []
      };
    },
    clearPeer: (id, error) => {
      const state = peerStates[id];
      if (!state) return;
      state.handshakeTimer = resetTimer(state.handshakeTimer);
      state.pendingHandshakePayloads.length = 0;
      state.handshakeWaiters.splice(0).forEach((waiter) => waiter.reject(error));
      delete peerStates[id];
    },
    canReceiveFromPeer: (id, receiveWhilePending) => {
      const state = peerStates[id];
      return Boolean(state && (state.isActive || receiveWhilePending));
    },
    start: (id, peer) => {
      const state = peerStates[id];
      if (!state || state.peer !== peer) return;
      state.handshakeTimer = setTimeout(() => failPeerHandshake(id, peer, mkErr(`handshake timed out after ${handshakeTimeoutMs}ms`)), handshakeTimeoutMs);
      const sendHandshake = async (data, metadata) => {
        await sendHandshakeData(data, id, metadata);
      };
      const receiveHandshake = () => new Promise((resolve, reject) => {
        const current = peerStates[id];
        if (!current || current.peer !== peer) {
          reject(mkErr("peer disconnected during handshake"));
          return;
        }
        const payload = current.pendingHandshakePayloads.shift();
        if (payload) {
          resolve(payload);
          return;
        }
        current.handshakeWaiters.push({
          resolve,
          reject: (error) => reject(error)
        });
      });
      const isInitiator = selfId < id;
      Promise.resolve(onPeerHandshake?.(id, sendHandshake, receiveHandshake, isInitiator)).then(() => markLocalHandshakePassed(id, peer)).catch((err) => failPeerHandshake(id, peer, toError(err, "handshake failed")));
    },
    receiveHandshakeData: (data, id, metadata) => {
      const state = peerStates[id];
      if (!state || state.isActive) return;
      const payload = metadata === void 0 ? { data } : {
        data,
        metadata
      };
      const pending = state.handshakeWaiters.shift();
      if (pending) {
        pending.resolve(payload);
        return;
      }
      if (state.pendingHandshakePayloads.length >= 16) {
        failPeerHandshake(id, state.peer, mkErr("too many pending handshake messages"));
        return;
      }
      state.pendingHandshakePayloads.push(payload);
    },
    receiveHandshakeReady: (id) => {
      const state = peerStates[id];
      if (!state || state.isActive) return;
      state.didReceiveRemoteReady = true;
      maybeActivatePeer(id);
    }
  };
};

// node_modules/@trystero-p2p/core/dist/data-limits.mjs
var maxActionFrameBytes = 16384;
var pendingDataTimeoutMs = 1e4;
var transferTimeoutMs = 12e4;

// node_modules/@trystero-p2p/core/dist/peer.mjs
var iceTimeout = 15e3;
var iceCandidateSettleMs = 150;
var disconnectedCloseDelayMs = 5e3;
var iceCandidateEvent = "icecandidate";
var iceStateEvent = "icegatheringstatechange";
var iceConnectionStateEvent = "iceconnectionstatechange";
var offerType = "offer";
var answerType = "answer";
var outOfRangePattern = /out of range/i;
var maxPendingRemoteCandidates = 128;
var maxRemoteCandidateSdpLength = 8192;
var rewriteMdnsCandidatesToLoopback = (sdp) => sdp.replace(/ (\S+\.local) (\d+) typ host/g, " 127.0.0.1 $2 typ host");
var peer_default = (initiator, { trickleIce, rtcConfig, rtcPolyfill, turnConfig, _test_only_mdnsHostFallbackToLoopback }) => {
  const pc = new (rtcPolyfill ?? RTCPeerConnection)({
    iceServers: defaultIceServers.concat(turnConfig ?? []),
    ...rtcConfig
  });
  const handlers = {};
  const pendingIceGathering = /* @__PURE__ */ new Set();
  const pendingSignals = [];
  const pendingData = [];
  let pendingDataTimer = null;
  const shouldTrickleIce = trickleIce !== false;
  const pendingRemoteCandidates = [];
  const pendingTracks = [];
  let resolveInitialOffer;
  let makingOffer = false;
  let isSettingRemoteAnswerPending = false;
  let dataChannel = null;
  let disconnectedCloseTimer = null;
  let didEmitClose = false;
  const settleInitialOffer = (signal) => {
    if (resolveInitialOffer) {
      resolveInitialOffer(signal);
      resolveInitialOffer = void 0;
    }
  };
  const clearDisconnectedCloseTimer = () => disconnectedCloseTimer = resetTimer(disconnectedCloseTimer);
  const emitClose = () => {
    if (didEmitClose) return;
    didEmitClose = true;
    pendingIceGathering.forEach((finish) => finish());
    pendingDataTimer = resetTimer(pendingDataTimer);
    pendingData.length = 0;
    clearDisconnectedCloseTimer();
    handlers.close?.();
  };
  const emitSignal = (signal) => {
    if (signal.type === offerType) {
      settleInitialOffer(signal);
      if (!handlers.signal && !pc.remoteDescription) return;
    }
    if (handlers.signal) handlers.signal(signal);
    else pendingSignals.push(signal);
  };
  const appendSignalHandler = (handler) => {
    const previousSignalHandler = handlers.signal;
    handlers.signal = (signal) => {
      previousSignalHandler?.(signal);
      handler(signal);
    };
    if (pendingSignals.length > 0) pendingSignals.splice(0).forEach((signal) => handlers.signal?.(signal));
  };
  const normalizeSdp = (sdp) => _test_only_mdnsHostFallbackToLoopback ? rewriteMdnsCandidatesToLoopback(sdp) : sdp;
  const normalizeCandidate = (candidate) => {
    if (!_test_only_mdnsHostFallbackToLoopback || typeof candidate.candidate !== "string") return candidate;
    const normalizedCandidate = rewriteMdnsCandidatesToLoopback(candidate.candidate);
    return normalizedCandidate === candidate.candidate ? candidate : {
      ...candidate,
      candidate: normalizedCandidate
    };
  };
  const localDescriptionSignal = (peerConnection) => ({
    type: peerConnection.localDescription?.type ?? offerType,
    sdp: normalizeSdp(peerConnection.localDescription?.sdp ?? "")
  });
  const getRemoteUfrag = () => {
    const sdp = pc.remoteDescription?.sdp;
    if (!sdp) return null;
    return sdp.match(/a=ice-ufrag:([^\s]+)/)?.[1] ?? null;
  };
  const getRemoteMediaSectionCount = () => (pc.remoteDescription?.sdp?.match(/^m=/gm) ?? []).length;
  const canApplyRemoteCandidate = (candidate) => {
    if (!pc.remoteDescription) return false;
    const remoteMLineCount = getRemoteMediaSectionCount();
    if (typeof candidate.sdpMLineIndex === "number" && remoteMLineCount > 0 && candidate.sdpMLineIndex >= remoteMLineCount) return false;
    const remoteUfrag = getRemoteUfrag();
    if (remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag) return false;
    return true;
  };
  const addIceCandidateSafe = async (candidate) => {
    try {
      await pc.addIceCandidate(candidate);
      return true;
    } catch (err) {
      if (err instanceof Error && outOfRangePattern.test(err.message) && typeof candidate.sdpMLineIndex === "number") return false;
      throw err;
    }
  };
  const queueRemoteCandidate = (candidate) => {
    if (pendingRemoteCandidates.length >= maxPendingRemoteCandidates) pendingRemoteCandidates.shift();
    pendingRemoteCandidates.push(candidate);
  };
  const flushPendingRemoteCandidates = async () => {
    if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) return;
    const remoteUfrag = getRemoteUfrag();
    const queuedCandidates = pendingRemoteCandidates.splice(0);
    const stillPending = [];
    for (const candidate of queuedCandidates) {
      if (remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag) continue;
      if (!canApplyRemoteCandidate(candidate)) {
        stillPending.push(candidate);
        continue;
      }
      if (!await addIceCandidateSafe(candidate)) stillPending.push(candidate);
    }
    stillPending.forEach(queueRemoteCandidate);
  };
  const addRemoteCandidate = async (candidate) => {
    if (canApplyRemoteCandidate(candidate)) {
      if (!await addIceCandidateSafe(candidate)) queueRemoteCandidate(candidate);
      return;
    }
    queueRemoteCandidate(candidate);
  };
  const setupDataChannel = (channel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 65535;
    const failData = () => {
      console.warn(`${libName}: invalid or excessive data before handler registration; disconnecting peer`);
      channel.close();
      pc.close();
      emitClose();
    };
    channel.onmessage = (e) => {
      const data = e.data;
      if (didEmitClose) return;
      if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) || data.byteLength > 16515) {
        failData();
        return;
      }
      if (handlers.data) handlers.data(data);
      else {
        if (pendingData.length >= 64) {
          failData();
          return;
        }
        if (!pendingDataTimer) pendingDataTimer = setTimeout(failData, pendingDataTimeoutMs);
        pendingData.push(data);
      }
    };
    channel.onopen = () => handlers.connect?.();
    channel.onclose = emitClose;
    channel.onerror = ({ error }) => {
      if (didEmitClose || error?.errorDetail === "sctp-failure" && (error.sctpCauseCode === 12 || /^User-Initiated Abort\b/.test(error.message))) return;
      handlers.error?.(toError(error, "data channel error"));
    };
  };
  const configuredIceServers = rtcConfig?.iceServers ?? defaultIceServers.concat(turnConfig ?? []);
  const hasServerUrlPattern = (pattern) => configuredIceServers.some(({ urls }) => (Array.isArray(urls) ? urls : [urls]).some((url) => pattern.test(url)));
  const expectsTurnCandidate = hasServerUrlPattern(/^turns?:/i);
  const expectsStunCandidate = !expectsTurnCandidate && hasServerUrlPattern(/^stuns?:/i);
  const targetCandidatePattern = expectsTurnCandidate ? /\btyp relay\b/ : expectsStunCandidate ? /\btyp (?:srflx|relay|prflx)\b/ : /\btyp (?:host|srflx|relay|prflx)\b/;
  const waitForIceGathering = async (peerConnection) => {
    await new Promise((resolve) => {
      let timeout = null;
      let settleTimeout = null;
      const finish = () => {
        resetTimer(timeout);
        resetTimer(settleTimeout);
        peerConnection.removeEventListener(iceStateEvent, checkState);
        peerConnection.removeEventListener(iceCandidateEvent, onCandidate);
        pendingIceGathering.delete(finish);
        resolve();
      };
      const scheduleSettle = (candidateLine = "") => {
        const sdp = `${peerConnection.localDescription?.sdp ?? ""}
${candidateLine}`;
        if (targetCandidatePattern.test(sdp)) {
          resetTimer(settleTimeout);
          settleTimeout = setTimeout(finish, iceCandidateSettleMs);
        }
      };
      const checkState = () => {
        if (peerConnection.iceGatheringState === "complete" || didEmitClose) finish();
        else scheduleSettle();
      };
      const onCandidate = (event) => {
        const { candidate } = event;
        if (candidate) scheduleSettle(candidate.candidate);
        else finish();
      };
      pendingIceGathering.add(finish);
      timeout = setTimeout(finish, iceTimeout);
      peerConnection.addEventListener(iceStateEvent, checkState);
      peerConnection.addEventListener(iceCandidateEvent, onCandidate);
      checkState();
    });
    return localDescriptionSignal(peerConnection);
  };
  const emitLocalDescriptionSignal = async () => {
    const signal = shouldTrickleIce ? localDescriptionSignal(pc) : await waitForIceGathering(pc);
    if (!didEmitClose) emitSignal(signal);
    return signal;
  };
  if (initiator) {
    dataChannel = pc.createDataChannel("data");
    setupDataChannel(dataChannel);
  } else pc.ondatachannel = ({ channel }) => {
    dataChannel = channel;
    setupDataChannel(channel);
  };
  const createOffer = async (restartIce = false) => {
    if (pc.connectionState === "closed" || !restartIce && (makingOffer || pc.signalingState !== "stable")) {
      if (pc.connectionState === "closed") settleInitialOffer();
      return;
    }
    try {
      makingOffer = true;
      if (restartIce) {
        if (pc.remoteDescription && pc.signalingState !== "stable" && pc.signalingState !== "closed" && pc.localDescription?.type === offerType) await pc.setLocalDescription({ type: "rollback" });
        if (typeof pc.restartIce === "function") pc.restartIce();
      }
      await pc.setLocalDescription(restartIce ? await pc.createOffer({ iceRestart: true }) : void 0);
      return await emitLocalDescriptionSignal();
    } catch (err) {
      if (!restartIce) settleInitialOffer();
      handlers.error?.(toError(err, "failed to create local offer"));
    } finally {
      makingOffer = false;
    }
  };
  pc.onnegotiationneeded = async () => createOffer(false);
  pc.onicecandidate = ({ candidate }) => {
    if (!shouldTrickleIce || !candidate) return;
    const candidatePayload = normalizeCandidate(typeof candidate.toJSON === "function" ? candidate.toJSON() : {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    });
    emitSignal({
      type: candidateType,
      sdp: JSON.stringify(candidatePayload)
    });
  };
  const handleConnectionStateChange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
      emitClose();
      return;
    }
    if (pc.connectionState === "connected" || pc.connectionState === "connecting" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.iceConnectionState === "checking") {
      clearDisconnectedCloseTimer();
      return;
    }
    if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") {
      if (!disconnectedCloseTimer) disconnectedCloseTimer = setTimeout(() => {
        disconnectedCloseTimer = null;
        if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") emitClose();
      }, disconnectedCloseDelayMs);
      return;
    }
  };
  pc.onconnectionstatechange = handleConnectionStateChange;
  pc.addEventListener(iceConnectionStateEvent, handleConnectionStateChange);
  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (stream) {
      if (!handlers.track && !handlers.stream) {
        pendingTracks.push({
          track: e.track,
          stream
        });
        return;
      }
      handlers.track?.(e.track, stream);
      handlers.stream?.(stream);
    }
  };
  const offerPromise = initiator ? new Promise((res) => {
    resolveInitialOffer = res;
  }) : Promise.resolve();
  if (initiator) queueMicrotask(() => {
    if (!makingOffer && pc.signalingState === "stable" && !pc.localDescription && pc.connectionState !== "closed") pc.onnegotiationneeded?.(new Event("negotiationneeded"));
  });
  return {
    connection: pc,
    get channel() {
      return dataChannel;
    },
    get isDead() {
      return pc.connectionState === "closed";
    },
    getOffer: async (restartIce = false) => {
      if (!initiator) return;
      if (restartIce) return createOffer(true);
      if (resolveInitialOffer) return offerPromise;
      if (pc.localDescription?.type === offerType) return shouldTrickleIce ? localDescriptionSignal(pc) : waitForIceGathering(pc);
      return offerPromise;
    },
    async signal(sdp) {
      if (sdp.type === "candidate") {
        if (sdp.sdp.length > maxRemoteCandidateSdpLength) return;
        try {
          const candidate = JSON.parse(sdp.sdp);
          if (candidate && typeof candidate === "object") await addRemoteCandidate(normalizeCandidate(candidate));
        } catch (err) {
          handlers.error?.(toError(err, "failed to parse remote candidate"));
        }
        return;
      }
      if (dataChannel?.readyState === "open" && !sdp.sdp?.includes("a=rtpmap")) return;
      try {
        const rtcSdp = {
          ...sdp,
          sdp: normalizeSdp(sdp.sdp)
        };
        if (sdp.type === offerType) {
          const isCollision = makingOffer || pc.signalingState !== "stable" && !isSettingRemoteAnswerPending;
          if (isCollision && initiator) return;
          if (isCollision && pc.signalingState !== "stable") await all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(rtcSdp)]);
          else await pc.setRemoteDescription(rtcSdp);
          await flushPendingRemoteCandidates();
          await pc.setLocalDescription();
          return await emitLocalDescriptionSignal();
        }
        if (sdp.type === answerType) {
          isSettingRemoteAnswerPending = true;
          try {
            await pc.setRemoteDescription(rtcSdp);
            await flushPendingRemoteCandidates();
          } finally {
            isSettingRemoteAnswerPending = false;
          }
        }
      } catch (err) {
        handlers.error?.(toError(err, "failed to apply remote signal"));
      }
    },
    sendData: (data) => dataChannel?.send(data),
    destroy: () => {
      clearDisconnectedCloseTimer();
      settleInitialOffer();
      dataChannel?.close();
      pc.close();
      makingOffer = false;
      isSettingRemoteAnswerPending = false;
      emitClose();
    },
    setHandlers: (newHandlers) => {
      const { signal, ...restHandlers } = newHandlers;
      Object.assign(handlers, restHandlers);
      if (handlers.data && pendingData.length > 0) {
        pendingDataTimer = resetTimer(pendingDataTimer);
        pendingData.splice(0).forEach((data) => handlers.data?.(data));
      }
      if (signal) appendSignalHandler(signal);
      if ((handlers.track || handlers.stream) && pendingTracks.length > 0) pendingTracks.splice(0).forEach(({ track, stream }) => {
        handlers.track?.(track, stream);
        handlers.stream?.(stream);
      });
    },
    addStream: (stream) => stream.getTracks().forEach((track) => pc.addTrack(track, stream)),
    removeStream: (stream) => pc.getSenders().filter((sender) => sender.track && stream.getTracks().includes(sender.track)).forEach((sender) => pc.removeTrack(sender)),
    addTrack: (track, stream) => pc.addTrack(track, stream),
    removeTrack: (track) => {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) pc.removeTrack(sender);
    },
    replaceTrack: (oldTrack, newTrack) => {
      const sender = pc.getSenders().find((s) => s.track === oldTrack);
      if (sender) return sender.replaceTrack(newTrack);
    }
  };
};
var defaultIceServers = [...alloc(3, (_, i) => `stun:stun${i || ""}.l.google.com:19302`), "stun:stun.cloudflare.com:3478"].map((url) => ({ urls: url }));

// node_modules/@trystero-p2p/core/dist/action-receiver.mjs
var maxPendingTransfers = 1024;
var maxPendingPerPeer = 64;
var maxDecisions = 128;
var maxDecisionsPerPeer = 8;
var emptyBytes = /* @__PURE__ */ new Uint8Array();
var decideReceive = (decide, settle) => {
  let result;
  try {
    result = decide();
  } catch {
    return settle(false);
  }
  return typeof result === "boolean" ? settle(result) : Promise.resolve(result).then((value) => settle(value === true), () => settle(false));
};
var decodePayload = (bytes, format, copy) => format === 2 ? copy ? bytes.slice() : bytes : format === 1 ? fromJson(decodeBytes(bytes)) : decodeBytes(bytes);
var progress = (action, value, peerId, metadata) => {
  try {
    action.progress(value, peerId, metadata);
  } catch (error) {
    console.error(`${libName} progress handler error:`, error);
  }
};
var deliverPayload = (action, data, peerId, metadata) => {
  progress(action, 1, peerId, metadata);
  try {
    action.receiver?.(data, peerId, metadata);
  } catch (error) {
    console.error(`${libName} action handler error:`, error);
  }
};
var createActionReceiver = ({ fail, accept, refuse, maxReceiveBytes, chunkSize: chunkSize2 }) => {
  const actions = /* @__PURE__ */ new Map();
  const peers = /* @__PURE__ */ new Map();
  const waiting = /* @__PURE__ */ new Set();
  const decisions = /* @__PURE__ */ new Map();
  let pendingCount = 0;
  let decisionCount = 0;
  let reservedBytes = 0;
  let draining = false;
  let drainAgain = false;
  const current = (state) => state.phase !== "released";
  const payloadLimit = (action) => Math.min(maxReceiveBytes, action?.maxPayloadBytes ?? maxReceiveBytes);
  const notifyRejected = (message, reason, scope, bulkId) => {
    scope?.reject(reason);
    actions.get(message.type)?.reject?.(message.peerId, message.metadata, reason);
    if (bulkId !== void 0) refuse(message.peerId, bulkId, reason);
  };
  const rotateWaitingForPeer = (peerId) => {
    for (const queued of Array.from(waiting)) if (queued.peerId === peerId) {
      waiting.delete(queued);
      waiting.add(queued);
    }
  };
  const release = (state) => {
    if (!current(state)) return;
    state.phase = "released";
    state.removeAbortListener?.();
    state.timer = resetTimer(state.timer);
    const peer = peers.get(state.peerId);
    if (state.kind === "inline") {
      const queue = peer.inline.get(state.key);
      queue.splice(queue.indexOf(state), 1);
      if (!queue.length) peer.inline.delete(state.key);
      state.data = emptyBytes;
    } else {
      peer.bulk.delete(state.id);
      waiting.delete(state);
      state.data = null;
      if (state.transfer === "receiving") {
        reservedBytes -= state.size;
        if (peer.active === state) {
          peer.active = null;
          rotateWaitingForPeer(state.peerId);
        }
        drainAgain = true;
      }
    }
    peer.count--;
    pendingCount--;
    if (!peer.count) peers.delete(state.peerId);
    state.controller?.abort();
  };
  const reject = (state, reason) => {
    if (!current(state)) return;
    release(state);
    notifyRejected(state, reason, state.scope, state.kind === "bulk" ? state.id : void 0);
  };
  const admit = (state, action) => {
    if (state.phase !== "pending") return state.phase === "ready";
    if (state.size > payloadLimit(action)) {
      reject(state, "payload exceeds receiver size limit");
      return false;
    }
    const receive = state.scope ? state.scope.receive : action.receive;
    if (!receive) {
      if (!action.receiver) return false;
      state.phase = "ready";
      return true;
    }
    if (decisionCount >= maxDecisions || (decisions.get(state.peerId) ?? 0) >= maxDecisionsPerPeer) {
      reject(state, "too many pending receive decisions");
      return false;
    }
    state.phase = "deciding";
    const controller = new AbortController();
    state.controller = controller;
    decisionCount++;
    decisions.set(state.peerId, (decisions.get(state.peerId) ?? 0) + 1);
    const result = decideReceive(() => receive({
      byteLength: state.size,
      peerId: state.peerId,
      signal: controller.signal,
      ...state.metadata === void 0 ? {} : { metadata: state.metadata }
    }), (allow) => {
      decisionCount--;
      const count = decisions.get(state.peerId) - 1;
      if (count) decisions.set(state.peerId, count);
      else decisions.delete(state.peerId);
      if (!current(state)) return false;
      if (allow) state.phase = "ready";
      else reject(state, "payload rejected by receiver");
      return allow;
    });
    if (typeof result === "boolean") return result;
    result.then(() => drain());
    return false;
  };
  const complete = (state, action, bytes) => {
    let payload;
    try {
      payload = decodePayload(bytes, state.format, state.kind === "inline");
    } catch {
      release(state);
      fail(state.peerId, "invalid action payload");
      return;
    }
    release(state);
    deliverPayload(action, payload, state.peerId, state.metadata);
  };
  const tryInline = (state) => {
    const action = actions.get(state.type);
    if (current(state) && action && admit(state, action) && action.receiver) complete(state, action, state.data);
  };
  const tryBulk = (state) => {
    const action = actions.get(state.type);
    if (!current(state) || !action || !admit(state, action) || !action.receiver) return;
    if (state.transfer === "receiving") {
      if (state.offset === state.size) complete(state, action, state.data);
      return;
    }
    const peer = peers.get(state.peerId);
    if (!peer.active && reservedBytes + state.size <= maxReceiveBytes) {
      peer.active = state;
      state.transfer = "receiving";
      reservedBytes += state.size;
      state.lastSeen = Date.now();
      waiting.delete(state);
      accept(state.peerId, state.id);
    }
  };
  const drainInline = (peerId, key) => {
    const queue = peers.get(peerId)?.inline.get(key);
    while (queue?.[0]) {
      const state = queue[0];
      tryInline(state);
      if (current(state)) break;
    }
  };
  const drain = () => {
    if (draining) {
      drainAgain = true;
      return;
    }
    draining = true;
    try {
      do {
        drainAgain = false;
        for (const state of waiting) tryBulk(state);
        for (const [id, peer] of peers) {
          for (const state of peer.bulk.values()) if (state.offset === state.size) tryBulk(state);
          for (const key of peer.inline.keys()) drainInline(id, key);
        }
      } while (drainAgain);
    } finally {
      draining = false;
    }
  };
  const enqueue = (state) => {
    let peer = peers.get(state.peerId);
    if (pendingCount >= maxPendingTransfers || (peer?.count ?? 0) >= maxPendingPerPeer) {
      notifyRejected(state, "too many pending transfers", state.scope, state.kind === "bulk" ? state.id : void 0);
      return false;
    }
    if (!peer) {
      peer = {
        bulk: /* @__PURE__ */ new Map(),
        inline: /* @__PURE__ */ new Map(),
        active: null,
        count: 0
      };
      peers.set(state.peerId, peer);
    }
    peer.count++;
    pendingCount++;
    if (state.kind === "inline") {
      const queue = peer.inline.get(state.key) ?? [];
      queue.push(state);
      peer.inline.set(state.key, queue);
    } else {
      peer.bulk.set(state.id, state);
      waiting.add(state);
    }
    const expire = () => {
      const remaining = transferTimeoutMs - (Date.now() - state.lastSeen);
      if (remaining > 0) state.timer = setTimeout(expire, remaining);
      else {
        reject(state, "action transfer timed out");
        drain();
      }
    };
    state.timer = setTimeout(expire, transferTimeoutMs);
    if (state.scope) {
      const { signal } = state.scope;
      const cancel = () => {
        reject(state, "receive cancelled");
        drain();
      };
      signal.addEventListener("abort", cancel, { once: true });
      state.removeAbortListener = () => signal.removeEventListener("abort", cancel);
      if (signal.aborted) {
        cancel();
        return false;
      }
    }
    return true;
  };
  const resolveAdmission = (message, bulkId) => {
    const action = actions.get(message.type);
    const scope = action?.receiveScope?.(message.peerId, message.metadata);
    if (scope === null || scope?.signal.aborted) {
      if (bulkId !== void 0) refuse(message.peerId, bulkId, "unexpected response");
      return null;
    }
    if (message.size > payloadLimit(action)) {
      notifyRejected(message, "payload exceeds receiver size limit", scope, bulkId);
      return null;
    }
    return {
      action,
      scope
    };
  };
  const admission = (message, scope) => ({
    ...message,
    ...scope ? { scope } : {},
    phase: "pending",
    controller: null,
    lastSeen: Date.now(),
    timer: null
  });
  return {
    register: (type, options = {}) => {
      const action = {
        ...options,
        receiver: null,
        receive: null,
        reject: null,
        progress: noOp
      };
      actions.set(type, action);
      return {
        onMessage: (handler) => {
          action.receiver = handler;
          drain();
        },
        onReceive: (handler) => {
          action.receive = handler;
          drain();
        },
        onReject: (handler) => {
          action.reject = handler;
        },
        onProgress: (handler) => {
          action.progress = handler;
        }
      };
    },
    receiveInline: (message, data) => {
      const resolved = resolveAdmission(message);
      if (!resolved) return;
      const { action, scope } = resolved;
      const key = scope ? `${message.type}\0${scope.key}` : message.type;
      if (action?.receiver && !(scope ? scope.receive : action.receive) && !peers.get(message.peerId)?.inline.has(key)) {
        let payload;
        try {
          payload = decodePayload(data, message.format, true);
        } catch {
          fail(message.peerId, "invalid action payload");
          return;
        }
        deliverPayload(action, payload, message.peerId, message.metadata);
        return;
      }
      const state = {
        ...admission(message, scope),
        kind: "inline",
        key,
        data
      };
      if (enqueue(state)) drainInline(message.peerId, key);
    },
    receiveOffer: (message, id) => {
      if (peers.get(message.peerId)?.bulk.has(id)) {
        fail(message.peerId, "duplicate action offer");
        return;
      }
      const resolved = resolveAdmission(message, id);
      if (!resolved) return;
      const state = {
        ...admission(message, resolved.scope),
        kind: "bulk",
        id,
        transfer: "waiting",
        offset: 0,
        data: null
      };
      if (enqueue(state)) drain();
    },
    receiveChunk: (peerId, id, offset, data) => {
      const peer = peers.get(peerId);
      const state = peer?.bulk.get(id);
      if (!state) return;
      if (state.transfer !== "receiving" || offset !== state.offset || !data.length || data.length !== Math.min(chunkSize2, state.size - state.offset)) {
        fail(peerId, "invalid action chunk offset or length");
        return;
      }
      try {
        state.data ??= new Uint8Array(state.size);
      } catch {
        reject(state, "unable to allocate receive buffer");
        drain();
        return;
      }
      state.data.set(data, state.offset);
      state.offset += data.length;
      const now = Date.now();
      state.lastSeen = now;
      for (const queued of waiting) if (queued.phase === "ready" && actions.get(queued.type)?.receiver) queued.lastSeen = now;
      if (state.offset === state.size) {
        tryBulk(state);
        if (current(state) && peer?.active === state) {
          peer.active = null;
          rotateWaitingForPeer(peerId);
        }
        drain();
      } else progress(actions.get(state.type), state.offset / state.size, peerId, state.metadata);
    },
    cancel: (peerId, id) => {
      const state = peers.get(peerId)?.bulk.get(id);
      if (state) {
        release(state);
        state.scope?.reject("response cancelled by sender");
      }
      drain();
    },
    clearPeer: (peerId) => {
      const peer = peers.get(peerId);
      if (peer) {
        for (const state of peer.bulk.values()) release(state);
        for (const queue of peer.inline.values()) {
          const queuedMessages = [...queue];
          for (const state of queuedMessages) release(state);
        }
      }
      drain();
    }
  };
};

// node_modules/@trystero-p2p/core/dist/action-wire.mjs
var version = 2;
var inline = 0;
var offer = 1;
var chunk = 2;
var accepted = 3;
var rejected = 4;
var cancelled = 5;
var inlineHeaderSize = 36;
var offerHeaderSize = 48;
var controlHeaderSize = 6;
var chunkHeaderSize = 14;
var chunkSize = maxActionFrameBytes - chunkHeaderSize;
var defaultMaxReceiveBytes = 256 * 1024 ** 2;
var maxControlBufferedBytes = 1024 ** 2;
var buffLowEvent = "bufferedamountlow";
var channelCloseEvent = "close";
var channelErrorEvent = "error";
var backpressureWaitTimeoutMs = 1e4;
var makeActionError = (kind, message) => {
  const error = mkErr(message);
  error.kind = kind;
  error.name = kind === "aborted" ? "AbortError" : error.name;
  return error;
};
var throwIfAborted = (signal) => {
  if (signal?.aborted) throw makeActionError("aborted", "operation aborted");
};
var packet = (kind, id, size = controlHeaderSize) => {
  const bytes = new Uint8Array(size);
  bytes[0] = version;
  bytes[1] = kind;
  new DataView(bytes.buffer).setUint32(2, id);
  return bytes;
};
var transferError = makeActionError;
var waitForBufferedAmountLow = (channel, signal, timeoutMs = backpressureWaitTimeoutMs) => {
  if (channel.readyState !== "open" || channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return Promise.resolve(channel.readyState === "open");
  return new Promise((res) => {
    let settled = false;
    let timeout = null;
    const finish = (didDrain) => {
      if (settled) return;
      settled = true;
      channel.removeEventListener(buffLowEvent, onBufferLow);
      channel.removeEventListener(channelCloseEvent, onCloseOrError);
      channel.removeEventListener(channelErrorEvent, onCloseOrError);
      signal?.removeEventListener("abort", onCloseOrError);
      resetTimer(timeout);
      res(didDrain);
    };
    const onBufferLow = () => finish(true);
    const onCloseOrError = () => finish(false);
    channel.addEventListener(buffLowEvent, onBufferLow);
    channel.addEventListener(channelCloseEvent, onCloseOrError);
    channel.addEventListener(channelErrorEvent, onCloseOrError);
    signal?.addEventListener("abort", onCloseOrError, { once: true });
    timeout = setTimeout(() => finish(false), timeoutMs);
    if (channel.readyState !== "open" || signal?.aborted) {
      finish(false);
      return;
    }
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish(true);
  });
};
var createActionWireManager = ({ getPeer, getPeerIds, canReceiveFromPeer, onPeerError, throwIfAborted: checkAborted = throwIfAborted, maxReceiveBytes = defaultMaxReceiveBytes }) => {
  if (!Number.isSafeInteger(maxReceiveBytes) || maxReceiveBytes <= 0) throw mkErr("maxReceiveBytes must be a positive safe integer");
  const actions = /* @__PURE__ */ new Map();
  const outgoing = /* @__PURE__ */ new Map();
  const failedPeers = /* @__PURE__ */ new WeakSet();
  let nextId = 0;
  const receiver = createActionReceiver({
    fail: (peerId, reason) => failPeer(peerId, reason),
    accept: (peerId, id) => control(peerId, id, accepted),
    refuse: (peerId, id, reason) => control(peerId, id, rejected, reason),
    maxReceiveBytes,
    chunkSize
  });
  const clearPeer = (peerId) => {
    for (const state of outgoing.get(peerId)?.values() ?? []) state.fail(transferError("disconnected", "peer disconnected"));
    outgoing.delete(peerId);
    receiver.clearPeer(peerId);
  };
  const failPeer = (peerId, reason) => {
    const peer = getPeer(peerId, true);
    if (peer && !failedPeers.has(peer)) {
      failedPeers.add(peer);
      console.warn(`${libName}: ${reason}; disconnecting peer ${peerId}`);
      onPeerError(peerId, mkErr(reason));
    }
  };
  const control = (peerId, id, kind, reason = "") => {
    const peer = getPeer(peerId, true);
    if (!peer) return;
    const text = encodeBytes(reason).subarray(0, 200);
    const bytes = packet(kind, id, controlHeaderSize + text.length);
    bytes.set(text, controlHeaderSize);
    try {
      if ((peer.channel?.bufferedAmount ?? 0) > maxControlBufferedBytes) throw mkErr("control send buffer is full");
      peer.sendData(bytes);
    } catch {
      failPeer(peerId, "unable to send action control");
    }
  };
  const makeInternalAction = (type, options = {}) => {
    const normalizedOptions = {
      sendToPending: Boolean(options.sendToPending),
      receiveWhilePending: Boolean(options.receiveWhilePending),
      ...options.maxPayloadBytes === void 0 ? {} : { maxPayloadBytes: options.maxPayloadBytes },
      ...options.receiveScope ? { receiveScope: options.receiveScope } : {}
    };
    const cached = actions.get(type);
    if (cached) {
      if (cached.options.sendToPending !== normalizedOptions.sendToPending || cached.options.receiveWhilePending !== normalizedOptions.receiveWhilePending || cached.options.receiveScope !== normalizedOptions.receiveScope || cached.options.maxPayloadBytes !== normalizedOptions.maxPayloadBytes) throw mkErr(`action type "${type}" cannot be redefined`);
      return cached.action;
    }
    const typeBytes = encodeBytes(type);
    if (!type || type.includes("\0") || typeBytes.length > 32) throw mkErr("action type must contain 1\u201332 UTF-8 bytes and no null characters");
    const action = {
      options: normalizedOptions,
      action: {
        ...receiver.register(type, normalizedOptions),
        send: async (data, targets, metadata, onProgress, signal) => {
          checkAborted(signal);
          if (data === void 0) throw mkErr("action data cannot be undefined");
          const isBlob = data instanceof Blob;
          const binary = isBlob || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
          const format = binary ? 2 : typeof data === "string" ? 0 : 1;
          let source = isBlob ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : encodeBytes(format === 0 ? data : toJson(data));
          const size = source instanceof Blob ? source.size : source.byteLength;
          const meta = metadata === void 0 ? /* @__PURE__ */ new Uint8Array() : encodeBytes(toJson(metadata));
          if (meta.length > 16336) throw mkErr("action metadata is too large");
          const small = inlineHeaderSize + meta.length + size <= maxActionFrameBytes;
          if (!small && binary && !(source instanceof Blob)) source = source.slice();
          const id = small ? 0 : nextId++ >>> 0;
          const headerSize = small ? inlineHeaderSize : offerHeaderSize;
          const start = new Uint8Array(headerSize + meta.length + (small ? size : 0));
          start[0] = version;
          start[1] = (small ? inline : offer) | format << 4;
          start.set(typeBytes, 2);
          const view = new DataView(start.buffer);
          view.setUint16(34, meta.length);
          if (!small) {
            view.setUint32(36, id);
            view.setFloat64(40, size);
          }
          start.set(meta, headerSize);
          if (small) start.set(source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source, headerSize + meta.length);
          const ids = targets ? Array.isArray(targets) ? targets : [targets] : getPeerIds(normalizedOptions.sendToPending);
          await all([...new Set(ids)].map(async (peerId) => {
            const peer = getPeer(peerId, normalizedOptions.sendToPending);
            if (!peer) {
              console.warn(`${libName}: no peer with id ${peerId} found`);
              return;
            }
            let failure = null;
            const check = () => {
              if (failure) throw failure;
              checkAborted(signal);
              if (getPeer(peerId, normalizedOptions.sendToPending) !== peer || peer.channel?.readyState === "closed") throw transferError("disconnected", "peer disconnected");
            };
            const sendFrame = async (bytes) => {
              check();
              const channel = peer.channel;
              if (channel && (channel.readyState !== "open" || channel.bufferedAmount > channel.bufferedAmountLowThreshold)) {
                if (!await waitForBufferedAmountLow(channel, signal)) {
                  checkAborted(signal);
                  throw transferError("disconnected", "data channel stopped draining");
                }
                check();
              }
              try {
                peer.sendData(bytes);
              } catch {
                throw transferError("disconnected", "peer disconnected");
              }
            };
            if (small) {
              await sendFrame(start);
              onProgress?.(1, peerId, metadata);
              return;
            }
            let didSendOffer = false;
            let settledByReceiver = false;
            let lastSeen = Date.now();
            let accept;
            let rejectOffer;
            const permission = new Promise((resolve, rejectPromise) => {
              accept = resolve;
              rejectOffer = rejectPromise;
            });
            permission.catch(noOp);
            const transfers = outgoing.get(peerId) ?? /* @__PURE__ */ new Map();
            if (transfers.has(id)) throw mkErr("action transmission id is still in use");
            outgoing.set(peerId, transfers);
            let timer = null;
            const state = {
              accept: () => {
                if (!timer || failure) return false;
                timer = resetTimer(timer);
                accept();
                return true;
              },
              fail: (error, fromReceiver = false) => {
                if (fromReceiver) settledByReceiver = true;
                failure = error;
                rejectOffer(error);
              },
              touch: () => {
                if (timer) lastSeen = Date.now();
              }
            };
            transfers.set(id, state);
            const expire = () => {
              const remaining = transferTimeoutMs - (Date.now() - lastSeen);
              if (remaining > 0) timer = setTimeout(expire, remaining);
              else state.fail(transferError("timeout", "action offer timed out"));
            };
            timer = setTimeout(expire, transferTimeoutMs);
            const abort = () => {
              try {
                checkAborted(signal);
              } catch (error) {
                state.fail(error);
              }
            };
            signal?.addEventListener("abort", abort, { once: true });
            try {
              await sendFrame(start);
              didSendOffer = true;
              await permission;
              for (let offset = 0; offset < size; offset += chunkSize) {
                check();
                const length = Math.min(chunkSize, size - offset);
                const bytes = packet(chunk, id, chunkHeaderSize + length);
                new DataView(bytes.buffer).setFloat64(controlHeaderSize, offset);
                bytes.set(source instanceof Blob ? new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()) : source.subarray(offset, offset + length), chunkHeaderSize);
                await sendFrame(bytes);
                for (const pending of transfers.values()) pending.touch();
                onProgress?.((offset + length) / size, peerId, metadata);
              }
              check();
            } catch (error) {
              if (didSendOffer && !settledByReceiver && getPeer(peerId, true) === peer && (!peer.channel || peer.channel.readyState === "open" && (peer.channel.bufferedAmount ?? 0) <= maxControlBufferedBytes)) control(peerId, id, cancelled);
              throw error;
            } finally {
              timer = resetTimer(timer);
              signal?.removeEventListener("abort", abort);
              transfers.delete(id);
              if (!transfers.size && outgoing.get(peerId) === transfers) outgoing.delete(peerId);
            }
          }));
        }
      }
    };
    actions.set(type, action);
    return action.action;
  };
  const handleData = (peerId, data) => {
    if (data.byteLength < 2 || data.byteLength > 16384) {
      failPeer(peerId, "invalid action frame");
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes[0] !== version) {
      failPeer(peerId, "incompatible action protocol version");
      return;
    }
    const kind = bytes[1] & 15;
    const format = bytes[1] >>> 4;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (kind > cancelled || format > 2 || kind > offer && format !== 0) {
      failPeer(peerId, "invalid action frame");
      return;
    }
    if (kind >= chunk) {
      if (bytes.length < controlHeaderSize || (kind === accepted || kind === cancelled) && bytes.length !== controlHeaderSize || kind === rejected && bytes.length > 206) {
        failPeer(peerId, "invalid action control");
        return;
      }
      const id2 = view.getUint32(2);
      if (kind === accepted) {
        const transfers = outgoing.get(peerId);
        if (transfers?.get(id2)?.accept()) for (const pending of transfers.values()) pending.touch();
        return;
      }
      if (kind === rejected) {
        outgoing.get(peerId)?.get(id2)?.fail(transferError("rejected", decodeBytes(bytes.subarray(controlHeaderSize))), true);
        return;
      }
      if (kind === cancelled) receiver.cancel(peerId, id2);
      else receiver.receiveChunk(peerId, id2, bytes.length >= chunkHeaderSize ? view.getFloat64(controlHeaderSize) : NaN, bytes.subarray(chunkHeaderSize));
      return;
    }
    const headerSize = kind === inline ? inlineHeaderSize : offerHeaderSize;
    if (bytes.length < headerSize) {
      failPeer(peerId, "invalid action header");
      return;
    }
    const type = decodeBytes(bytes.subarray(2, 34)).replaceAll("\0", "");
    const action = actions.get(type);
    if (!canReceiveFromPeer(peerId, Boolean(action?.options.receiveWhilePending))) return;
    const metaLength = view.getUint16(34);
    const payloadIndex = headerSize + metaLength;
    const size = kind === inline ? bytes.length - payloadIndex : view.getFloat64(40);
    const id = kind === offer ? view.getUint32(36) : 0;
    if (!type || payloadIndex > bytes.length || !Number.isSafeInteger(size) || size < 0 || kind === offer && (size === 0 || payloadIndex !== bytes.length)) {
      failPeer(peerId, "invalid action proposal");
      return;
    }
    let metadata;
    try {
      if (metaLength) metadata = fromJson(decodeBytes(bytes.subarray(headerSize, payloadIndex)));
    } catch {
      failPeer(peerId, "invalid action metadata");
      return;
    }
    const message = {
      peerId,
      type,
      format,
      size,
      ...metadata === void 0 ? {} : { metadata }
    };
    if (kind === inline) receiver.receiveInline(message, bytes.subarray(payloadIndex));
    else receiver.receiveOffer(message, id);
  };
  return {
    makeInternalAction,
    handleData,
    clearPeer
  };
};

// node_modules/@trystero-p2p/core/dist/actions.mjs
var getEnvelopeRecord = (metadata) => metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.r === "string" ? metadata : null;
var getRequestMetadata = (metadata) => {
  const record = getEnvelopeRecord(metadata);
  return record ? {
    r: record.r,
    ...Object.hasOwn(record, "m") ? { m: record.m } : {}
  } : null;
};
var getResponseMetadata = (metadata) => {
  const record = getEnvelopeRecord(metadata);
  return record ? {
    r: record.r,
    ...typeof record.e === "string" ? { e: record.e } : {}
  } : null;
};
var withMetadata = (context, metadata) => metadata === void 0 ? context : {
  ...context,
  metadata
};
var createActionManager = ({ getPeer, getPeerIds, canReceiveFromPeer, onPeerError, maxReceiveBytes }) => {
  const publicActions = /* @__PURE__ */ Object.create(null);
  const pendingRequestWaiters = {};
  const activeRequestControllers = /* @__PURE__ */ new Map();
  const wire = createActionWireManager({
    getPeer,
    getPeerIds,
    canReceiveFromPeer,
    onPeerError,
    ...maxReceiveBytes === void 0 ? {} : { maxReceiveBytes }
  });
  const makeInternalAction = wire.makeInternalAction;
  const handleData = wire.handleData;
  const clearPendingRequestWaiter = (requestId) => {
    const waiter = pendingRequestWaiters[requestId];
    if (!waiter) return;
    resetTimer(waiter.timer);
    if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener("abort", waiter.abortHandler);
    delete pendingRequestWaiters[requestId];
    waiter.controller.abort();
  };
  const rejectPendingRequestsForPeer = (id, error) => {
    entries(pendingRequestWaiters).forEach(([requestId, waiter]) => {
      if (waiter.peerId !== id) return;
      clearPendingRequestWaiter(requestId);
      waiter.reject(error);
    });
  };
  const clearPeer = (id, error) => {
    wire.clearPeer(id);
    const controllers = activeRequestControllers.get(id);
    if (controllers) {
      activeRequestControllers.delete(id);
      controllers.forEach((controller) => controller.abort());
    }
    rejectPendingRequestsForPeer(id, makeActionError("disconnected", toErrorMessage(error, "peer disconnected")));
  };
  const responseAction = makeInternalAction("@_response", { receiveScope: (peerId, metadata) => {
    const parsed = getResponseMetadata(metadata);
    const waiter = parsed && pendingRequestWaiters[parsed.r];
    if (!parsed || !waiter || waiter.peerId !== peerId) return null;
    const receive = parsed.e === void 0 ? waiter.getReceive() : null;
    return {
      key: parsed.r,
      signal: waiter.controller.signal,
      receive: receive ? (context) => receive({
        byteLength: context.byteLength,
        peerId: context.peerId,
        kind: "response",
        signal: context.signal
      }) : null,
      reject: (reason) => {
        if (pendingRequestWaiters[parsed.r] === waiter) {
          clearPendingRequestWaiter(parsed.r);
          waiter.reject(makeActionError("rejected", reason));
        }
      }
    };
  } });
  responseAction.onProgress((progress2, id, metadata) => {
    const parsed = getResponseMetadata(metadata);
    const waiter = parsed && pendingRequestWaiters[parsed.r];
    if (waiter && waiter.peerId === id && parsed?.e === void 0) waiter.getReceiveProgress()?.(progress2, { peerId: id });
  });
  responseAction.onMessage((payload, id, metadata) => {
    const parsed = getResponseMetadata(metadata);
    if (!parsed) return;
    const waiter = pendingRequestWaiters[parsed.r];
    if (!waiter || waiter.peerId !== id) return;
    clearPendingRequestWaiter(parsed.r);
    if (parsed.e !== void 0) {
      waiter.reject(makeActionError("rejected", parsed.e));
      return;
    }
    waiter.resolve(payload);
  });
  const makeActionImpl = (type, config) => {
    if (config && "onRequest" in config && config.kind !== "request") throw mkErr('request actions must use kind: "request"');
    const kind = config?.kind ?? "message";
    const rawAction = makeInternalAction(type);
    const existingState = publicActions[type];
    if (existingState) {
      if (existingState.kind !== kind) throw mkErr(`action type "${type}" cannot be redefined`);
      return existingState.action;
    }
    const state = {
      kind,
      action: null,
      onReceive: config?.onReceive ?? null,
      onReceiveProgress: config?.onReceiveProgress ?? null
    };
    const toProgressHandler = (handler, metadata) => handler ? (progress2, peerId) => handler(progress2, withMetadata({ peerId }, metadata)) : void 0;
    const dispatchReceiveProgress = (progress2, peerId, metadata) => {
      const requestMetadata = state.kind === "request" ? getRequestMetadata(metadata) : null;
      state.onReceiveProgress?.(progress2, withMetadata({ peerId }, requestMetadata ? requestMetadata.m : metadata));
    };
    const setReceive = (handler) => {
      state.onReceive = handler;
      rawAction.onReceive(handler ? (context) => {
        const requestMetadata = kind === "request" ? getRequestMetadata(context.metadata) : null;
        return handler(withMetadata({
          byteLength: context.byteLength,
          peerId: context.peerId,
          signal: context.signal,
          kind
        }, requestMetadata ? requestMetadata.m : context.metadata));
      } : null);
    };
    setReceive(state.onReceive);
    rawAction.onProgress(dispatchReceiveProgress);
    if (kind === "message") {
      let onMessage = config?.onMessage ?? null;
      const receiveMessage = (payload, peerId, metadata) => {
        const handler = onMessage;
        Promise.resolve().then(() => handler(payload, withMetadata({ peerId }, metadata))).catch((err) => console.error(`${libName} action handler error:`, err));
      };
      const action2 = {
        send: async (data, options = {}) => {
          await rawAction.send(data, options.target, options.metadata, toProgressHandler(options.onProgress, options.metadata), options.signal);
        },
        get onMessage() {
          return onMessage;
        },
        set onMessage(handler) {
          onMessage = handler;
          rawAction.onMessage(handler ? receiveMessage : null);
        },
        get onReceive() {
          return state.onReceive;
        },
        set onReceive(handler) {
          setReceive(handler);
        },
        get onReceiveProgress() {
          return state.onReceiveProgress;
        },
        set onReceiveProgress(handler) {
          state.onReceiveProgress = handler;
        }
      };
      state.action = action2;
      publicActions[type] = state;
      rawAction.onMessage(onMessage ? receiveMessage : null);
      return action2;
    }
    rawAction.onReject((peerId, metadata, reason) => {
      const parsed = getRequestMetadata(metadata);
      if (parsed) responseAction.send(null, peerId, {
        r: parsed.r,
        e: reason
      }).catch(noOp);
    });
    let onRequest = config?.onRequest ?? null;
    const receiveRequest = (payload, peerId, metadata) => {
      const parsed = getRequestMetadata(metadata);
      if (!parsed) return;
      const handler = onRequest;
      const controller = new AbortController();
      let peerControllers = activeRequestControllers.get(peerId);
      if (!peerControllers) {
        peerControllers = /* @__PURE__ */ new Set();
        activeRequestControllers.set(peerId, peerControllers);
      }
      peerControllers.add(controller);
      Promise.resolve().then(async () => {
        const response = await handler(payload, {
          ...withMetadata({ peerId }, parsed.m),
          signal: controller.signal
        });
        if (response === void 0) throw mkErr("request handler returned undefined");
        return response;
      }).then((response) => responseAction.send(response, peerId, { r: parsed.r }), (error) => responseAction.send(null, peerId, {
        r: parsed.r,
        e: toErrorMessage(error, "request failed").slice(0, 512)
      })).catch(noOp).finally(() => {
        const controllers = activeRequestControllers.get(peerId);
        controllers?.delete(controller);
        if (controllers && !controllers.size) activeRequestControllers.delete(peerId);
        controller.abort();
      });
    };
    const requestOne = async (data, options) => {
      const { target, metadata, onProgress, signal, timeoutMs } = options;
      throwIfAborted(signal);
      if (!getPeer(target, false)) throw makeActionError("disconnected", `no active peer with id ${target}`);
      const requestId = genId(20);
      const controller = new AbortController();
      const responsePromise = new Promise((resolve, reject) => {
        const waiter = {
          controller,
          getReceive: () => state.onReceive,
          getReceiveProgress: () => state.onReceiveProgress,
          peerId: target,
          resolve,
          reject,
          timer: null,
          ...signal === void 0 ? {} : { signal }
        };
        const rejectAsAborted = () => {
          clearPendingRequestWaiter(requestId);
          reject(makeActionError("aborted", "operation aborted"));
        };
        if (signal) {
          waiter.abortHandler = rejectAsAborted;
          signal.addEventListener("abort", rejectAsAborted, { once: true });
        }
        pendingRequestWaiters[requestId] = waiter;
        if (timeoutMs !== void 0) waiter.timer = setTimeout(() => {
          clearPendingRequestWaiter(requestId);
          waiter.reject(makeActionError("timeout", "request timed out"));
        }, timeoutMs);
      });
      try {
        const sending = rawAction.send(data, target, metadata === void 0 ? { r: requestId } : {
          r: requestId,
          m: metadata
        }, toProgressHandler(onProgress, metadata), controller.signal);
        return await Promise.race([responsePromise, sending.then(() => responsePromise)]);
      } finally {
        clearPendingRequestWaiter(requestId);
      }
    };
    const action = {
      request: requestOne,
      requestMany: async (data, options) => {
        const { targets, onResult, ...requestOptions } = options;
        throwIfAborted(requestOptions.signal);
        return await all(targets.map(async (target) => {
          try {
            const result = {
              peerId: target,
              status: "fulfilled",
              value: await requestOne(data, {
                ...requestOptions,
                target
              })
            };
            onResult?.(result);
            return result;
          } catch (err) {
            const error = toError(err, "request failed");
            if (error.kind === "aborted" || !error.kind) throw error;
            const result = error.kind === "timeout" ? {
              peerId: target,
              status: "timeout"
            } : error.kind === "disconnected" ? {
              peerId: target,
              status: "disconnected"
            } : {
              peerId: target,
              status: "rejected",
              error
            };
            onResult?.(result);
            return result;
          }
        }));
      },
      get onRequest() {
        return onRequest;
      },
      set onRequest(handler) {
        onRequest = handler;
        rawAction.onMessage(handler ? receiveRequest : null);
      },
      get onReceive() {
        return state.onReceive;
      },
      set onReceive(handler) {
        setReceive(handler);
      },
      get onReceiveProgress() {
        return state.onReceiveProgress;
      },
      set onReceiveProgress(handler) {
        state.onReceiveProgress = handler;
      }
    };
    state.action = action;
    publicActions[type] = state;
    rawAction.onMessage(onRequest ? receiveRequest : null);
    return action;
  };
  return {
    makeAction: makeActionImpl,
    makeInternalAction,
    handleData,
    clearPeer
  };
};

// node_modules/@trystero-p2p/core/dist/media.mjs
var toPendingMediaMeta = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.k === "string") return {
    key: value.k,
    ...typeof value.s === "string" ? { streamId: value.s } : {},
    ...typeof value.t === "string" ? { trackId: value.t } : {},
    ...Object.hasOwn(value, "m") ? { metadata: value.m } : {}
  };
  return null;
};
var makeKeyGetter = (map) => (item) => {
  let key = map.get(item);
  if (!key) {
    key = genId(20);
    map.set(item, key);
  }
  return key;
};
var createMediaIdentityCache = () => {
  const localStreamKeys = /* @__PURE__ */ new WeakMap();
  const localTrackKeys = /* @__PURE__ */ new WeakMap();
  const remoteStreamsByKey = /* @__PURE__ */ new Map();
  const remoteStreamsById = /* @__PURE__ */ new Map();
  const remoteTracksByKey = /* @__PURE__ */ new Map();
  const remoteTracksById = /* @__PURE__ */ new Map();
  const remoteStreamKeys = /* @__PURE__ */ new WeakMap();
  const remoteTrackKeys = /* @__PURE__ */ new WeakMap();
  return {
    getStreamKey: makeKeyGetter(localStreamKeys),
    getTrackKey: makeKeyGetter(localTrackKeys),
    rememberRemoteStream: (key, stream, streamId) => {
      const previous = remoteStreamKeys.get(stream);
      if (previous !== void 0 && remoteStreamsByKey.get(previous) === stream) remoteStreamsByKey.delete(previous);
      remoteStreamKeys.set(stream, key);
      remoteStreamsByKey.set(key, stream);
      if (streamId) remoteStreamsById.set(streamId, stream);
      stream.getTracks?.().forEach((track) => {
        if (typeof track.id === "string") remoteTracksById.set(track.id, {
          track,
          stream
        });
      });
    },
    getRemoteStream: (key, streamId) => remoteStreamsByKey.get(key) ?? (streamId ? remoteStreamsById.get(streamId) : void 0),
    rememberRemoteTrack: (key, track, stream, trackId, streamId) => {
      const ref = {
        track,
        stream
      };
      const previous = remoteTrackKeys.get(track);
      if (previous !== void 0 && remoteTracksByKey.get(previous)?.track === track) remoteTracksByKey.delete(previous);
      remoteTrackKeys.set(track, key);
      remoteTracksByKey.set(key, ref);
      if (trackId) remoteTracksById.set(trackId, ref);
      if (streamId) remoteStreamsById.set(streamId, stream);
    },
    getRemoteTrack: (key, trackId) => remoteTracksByKey.get(key) ?? (trackId ? remoteTracksById.get(trackId) : void 0),
    hasRemoteMedia: () => remoteStreamsByKey.size > 0 || remoteTracksByKey.size > 0,
    clearRemote: () => {
      remoteStreamsByKey.clear();
      remoteStreamsById.clear();
      remoteTracksByKey.clear();
      remoteTracksById.clear();
    }
  };
};
var createMediaManager = ({ iterate, isActive, getSharedMediaPeer, onPeerError }) => {
  const pendingStreamMetas = {};
  const pendingTrackMetas = {};
  const peerMediaCaches = {};
  const localMedia = createMediaIdentityCache();
  const getPeerMedia = (id) => getSharedMediaPeer(id)?.__trysteroMedia ?? (peerMediaCaches[id] ??= createMediaIdentityCache());
  const queuePendingMeta = (metas, id, parsed, kind) => {
    const queue = metas[id] ??= [];
    if (queue.length >= 64) {
      console.warn(`${libName}: too many pending ${kind} metadata messages`);
      onPeerError(id, mkErr("too many pending media metadata messages"));
      return;
    }
    queue.push(parsed);
  };
  const takePendingMeta = (queue, idValue, getMetaId) => {
    if (!queue?.length) return;
    const index = idValue ? queue.findIndex((meta) => {
      const metaId = getMetaId(meta);
      return !metaId || metaId === idValue;
    }) : 0;
    return index >= 0 ? queue.splice(index, 1)[0] : void 0;
  };
  const emitStream = (id, key, stream, metadata) => {
    if (!isActive(id)) return;
    getPeerMedia(id).rememberRemoteStream(key, stream, typeof stream.id === "string" ? stream.id : void 0);
    manager.onPeerStream?.(stream, id, metadata);
  };
  const emitTrack = (id, key, track, stream, metadata) => {
    if (!isActive(id)) return;
    getPeerMedia(id).rememberRemoteTrack(key, track, stream, typeof track.id === "string" ? track.id : void 0, typeof stream.id === "string" ? stream.id : void 0);
    manager.onPeerTrack?.(track, stream, id, metadata);
  };
  const applyMediaOp = (targets, key, metadata, sendMeta, op, mediaIds = {}) => {
    const payload = {
      k: key,
      ...mediaIds,
      ...metadata === void 0 ? {} : { m: metadata }
    };
    return iterate(targets, async (id, peer) => {
      await sendMeta(payload, id);
      await op(peer);
    });
  };
  const manager = {
    addStream: (stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getStreamKey(stream), options.metadata, sendMeta, (peer) => peer.addStream(stream), { s: stream.id }),
    removeStream: (stream, target) => {
      iterate(target, (_, peer) => peer.removeStream(stream));
    },
    addTrack: (track, stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(track), options.metadata, sendMeta, (peer) => peer.addTrack(track, stream), {
      s: stream.id,
      t: track.id
    }),
    removeTrack: (track, target) => {
      iterate(target, (_, peer) => peer.removeTrack(track));
    },
    replaceTrack: (oldTrack, newTrack, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(newTrack), options.metadata, sendMeta, (peer) => peer.replaceTrack(oldTrack, newTrack), { t: oldTrack.id }),
    receiveStreamMeta: (meta, id) => {
      if (!isActive(id)) return;
      const parsed = toPendingMediaMeta(meta);
      if (!parsed) return;
      const cached = getPeerMedia(id).getRemoteStream(parsed.key, parsed.streamId);
      if (cached?.getTracks().length) {
        emitStream(id, parsed.key, cached, parsed.metadata);
        return;
      }
      queuePendingMeta(pendingStreamMetas, id, parsed, "stream");
    },
    receiveTrackMeta: (meta, id) => {
      if (!isActive(id)) return;
      const parsed = toPendingMediaMeta(meta);
      if (!parsed) return;
      const cached = getPeerMedia(id).getRemoteTrack(parsed.key, parsed.trackId);
      if (cached && cached.track.readyState !== "ended" && (!cached.stream.getTracks || cached.stream.getTracks().includes(cached.track))) {
        emitTrack(id, parsed.key, cached.track, cached.stream, parsed.metadata);
        return;
      }
      queuePendingMeta(pendingTrackMetas, id, parsed, "track");
    },
    receiveRemoteStream: (id, stream) => {
      if (!isActive(id)) return;
      const next = takePendingMeta(pendingStreamMetas[id], typeof stream.id === "string" ? stream.id : void 0, (meta) => meta.streamId);
      if (!next) return;
      emitStream(id, next.key, stream, next.metadata);
    },
    receiveRemoteTrack: (id, track, stream) => {
      if (!isActive(id)) return;
      const queue = pendingTrackMetas[id];
      const trackId = typeof track.id === "string" ? track.id : void 0;
      const streamId = typeof stream.id === "string" ? stream.id : void 0;
      const byTrackIdx = queue && trackId ? queue.findIndex((meta) => meta.trackId === trackId) : -1;
      const next = byTrackIdx >= 0 ? queue?.splice(byTrackIdx, 1)[0] : takePendingMeta(queue, streamId, (meta) => meta.streamId);
      if (!next) return;
      emitTrack(id, next.key, track, stream, next.metadata);
    },
    clearPeer: (id) => {
      delete pendingStreamMetas[id];
      delete pendingTrackMetas[id];
      delete peerMediaCaches[id];
    },
    onPeerStream: null,
    onPeerTrack: null
  };
  return manager;
};

// node_modules/@trystero-p2p/core/dist/room.mjs
var unloadEvent = "beforeunload";
var defaultHandshakeTimeoutMs = 1e4;
var internalNs = (ns) => "@_" + ns;
var beforeUnloadRoomCleanups = /* @__PURE__ */ new Set();
var cleanupActiveRoomsOnBeforeUnload = () => beforeUnloadRoomCleanups.forEach((cleanup) => cleanup());
var registerBeforeUnloadCleanup = (cleanup) => {
  beforeUnloadRoomCleanups.add(cleanup);
  if (beforeUnloadRoomCleanups.size === 1) addEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
  return () => {
    beforeUnloadRoomCleanups.delete(cleanup);
    if (!beforeUnloadRoomCleanups.size) removeEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
  };
};
var room_default = (onPeer, onPeerLeave, onSelfLeave, { onPeerHandshake, onHandshakeError, handshakeTimeoutMs = defaultHandshakeTimeoutMs, maxReceiveBytes, isPassive = false, onBeforeLeave } = {}) => {
  const peerMap = {};
  const activePeerMap = {};
  const pendingPongs = {};
  const listeners = {
    onPeerJoin: null,
    onPeerLeave: null
  };
  let unregisterBeforeUnloadCleanup = noOp;
  let leavePromise = null;
  const iterate = (targets, f) => (targets ? Array.isArray(targets) ? targets : [targets] : keys(activePeerMap)).flatMap((id) => {
    const peer = activePeerMap[id];
    if (!peer) {
      console.warn(`${libName}: no peer with id ${id} found`);
      return [];
    }
    return [Promise.resolve(f(id, peer))];
  });
  const kickPeer = (id, peer, reason) => {
    const current = peerMap[id];
    if (!current || peer && current !== peer) return;
    leaveAction.send("", id).catch(noOp);
    exitPeer(id, current, reason);
  };
  const onPeerError = (id, error) => kickPeer(id, void 0, error);
  const mediaManager = createMediaManager({
    onPeerError,
    iterate: (targets, f) => iterate(targets, (id, peer) => f(id, peer)),
    isActive: (id) => Boolean(activePeerMap[id]),
    getSharedMediaPeer: (id) => peerMap[id] ?? null
  });
  const actionManager = createActionManager({
    onPeerError,
    ...maxReceiveBytes === void 0 ? {} : { maxReceiveBytes },
    getPeer: (id, includePending) => (includePending ? peerMap : activePeerMap)[id],
    getPeerIds: (includePending) => keys(includePending ? peerMap : activePeerMap),
    canReceiveFromPeer: (id, receiveWhilePending) => handshakeManager.canReceiveFromPeer(id, receiveWhilePending)
  });
  const makeActionInternal = actionManager.makeInternalAction;
  const handleData = actionManager.handleData;
  const makeAction = actionManager.makeAction;
  const clearPeerState = (id, reason = mkErr("peer disconnected")) => {
    const err = toError(reason, "peer disconnected");
    handshakeManager.clearPeer(id, err);
    delete peerMap[id];
    delete activePeerMap[id];
    actionManager.clearPeer(id, err);
    pendingPongs[id]?.splice(0).forEach((waiter) => waiter.reject(err));
    delete pendingPongs[id];
    mediaManager.clearPeer(id);
  };
  const exitPeer = (id, peer, reason) => {
    const current = peerMap[id];
    if (!current) return;
    if (peer && current !== peer) return;
    const wasActive = Boolean(activePeerMap[id]);
    clearPeerState(id, reason);
    current.destroy();
    if (wasActive) listeners.onPeerLeave?.(id);
    onPeerLeave(id);
  };
  const leave = () => leavePromise ??= (async () => {
    onBeforeLeave?.();
    const controller = new AbortController();
    leaveAction.send("", void 0, void 0, void 0, controller.signal).catch(noOp);
    await new Promise((res) => setTimeout(res, 99));
    controller.abort();
    try {
      entries(peerMap).forEach(([id, peer]) => {
        peer.destroy();
        clearPeerState(id, mkErr("room left"));
      });
    } finally {
      try {
        unregisterBeforeUnloadCleanup();
      } finally {
        onSelfLeave();
      }
    }
  })();
  const pingAction = makeActionInternal(internalNs("ping"));
  const pongAction = makeActionInternal(internalNs("pong"));
  const signalAction = makeActionInternal(internalNs("signal"));
  const streamMetaAction = makeActionInternal(internalNs("stream"), { maxPayloadBytes: 65536 });
  const trackMetaAction = makeActionInternal(internalNs("track"), { maxPayloadBytes: 65536 });
  const leaveAction = makeActionInternal(internalNs("leave"), {
    sendToPending: true,
    receiveWhilePending: true
  });
  const handshakeDataAction = makeActionInternal(internalNs("hsdata"), {
    sendToPending: true,
    receiveWhilePending: true,
    maxPayloadBytes: 65536
  });
  const handshakeReadyAction = makeActionInternal(internalNs("hsready"), {
    sendToPending: true,
    receiveWhilePending: true
  });
  const handshakeManager = createHandshakeManager({
    ...onPeerHandshake === void 0 ? {} : { onPeerHandshake },
    ...onHandshakeError === void 0 ? {} : { onHandshakeError },
    handshakeTimeoutMs,
    sendHandshakeData: handshakeDataAction.send,
    sendHandshakeReady: handshakeReadyAction.send,
    onActivate: (id, peer) => {
      activePeerMap[id] = peer;
      peer.setHandlers({ signal: (sdp) => {
        if (activePeerMap[id] === peer) signalAction.send(sdp, id).catch(noOp);
      } });
      listeners.onPeerJoin?.(id);
    },
    onFailure: (id, peer, reason) => kickPeer(id, peer, reason)
  });
  pingAction.onMessage((_, id) => {
    pongAction.send("", id).catch(noOp);
  });
  pongAction.onMessage((_, id) => {
    const queue = pendingPongs[id];
    queue?.shift()?.resolve();
    if (queue && !queue.length) delete pendingPongs[id];
  });
  signalAction.onMessage((sdp, id) => {
    activePeerMap[id]?.signal(sdp);
  });
  streamMetaAction.onMessage((meta, id) => mediaManager.receiveStreamMeta(meta, id));
  trackMetaAction.onMessage((meta, id) => mediaManager.receiveTrackMeta(meta, id));
  leaveAction.onMessage((_, id) => exitPeer(id, void 0, mkErr("peer left room")));
  handshakeDataAction.onMessage((data, id, metadata) => handshakeManager.receiveHandshakeData(data, id, metadata));
  handshakeReadyAction.onMessage((_, id) => handshakeManager.receiveHandshakeReady(id));
  onPeer((peer, id) => {
    const existingPeer = peerMap[id];
    if (existingPeer) {
      if (existingPeer === peer) return;
      existingPeer.destroy();
      clearPeerState(id, mkErr("peer replaced"));
    }
    peerMap[id] = peer;
    handshakeManager.addPeer(id, peer);
    peer.setHandlers({
      data: (d) => {
        if (peerMap[id] === peer) handleData(id, d);
      },
      stream: (stream) => mediaManager.receiveRemoteStream(id, stream),
      track: (track, stream) => mediaManager.receiveRemoteTrack(id, track, stream),
      close: () => exitPeer(id, peer, mkErr("peer disconnected")),
      error: (err) => {
        console.error(`${libName} peer error:`, err);
        exitPeer(id, peer, err);
      }
    });
    handshakeManager.start(id, peer);
  });
  if (isBrowser) unregisterBeforeUnloadCleanup = registerBeforeUnloadCleanup(() => leave().catch(noOp));
  return {
    makeAction,
    leave,
    ping: async (id) => {
      if (!activePeerMap[id]) throw mkErr(`no active peer with id ${id}`);
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const queue = pendingPongs[id] ??= [];
        const clearFromQueue = () => {
          const currentQueue = pendingPongs[id];
          if (!currentQueue) return;
          const i = currentQueue.indexOf(waiter);
          if (i > -1) currentQueue.splice(i, 1);
          if (!currentQueue.length) delete pendingPongs[id];
        };
        const waiter = {
          resolve: () => {
            clearFromQueue();
            resolve();
          },
          reject: (reason) => {
            clearFromQueue();
            reject(reason);
          }
        };
        queue.push(waiter);
        pingAction.send("", id).catch((err) => waiter.reject(toError(err, "peer disconnected")));
      });
      return Date.now() - start;
    },
    isPassive: () => isPassive,
    getPeers: () => fromEntries(entries(activePeerMap).map(([id, peer]) => [id, peer.connection])),
    addStream: (stream, options = {}) => mediaManager.addStream(stream, options, streamMetaAction.send),
    removeStream: (stream, options = {}) => {
      mediaManager.removeStream(stream, options.target);
    },
    addTrack: (track, stream, options = {}) => mediaManager.addTrack(track, stream, options, trackMetaAction.send),
    removeTrack: (track, options = {}) => {
      mediaManager.removeTrack(track, options.target);
    },
    replaceTrack: (oldTrack, newTrack, options = {}) => mediaManager.replaceTrack(oldTrack, newTrack, options, trackMetaAction.send),
    get onPeerJoin() {
      return listeners.onPeerJoin;
    },
    set onPeerJoin(handler) {
      listeners.onPeerJoin = handler;
      if (handler) keys(activePeerMap).forEach((peerId) => handler(peerId));
    },
    get onPeerLeave() {
      return listeners.onPeerLeave;
    },
    set onPeerLeave(handler) {
      listeners.onPeerLeave = handler;
    },
    get onPeerStream() {
      return mediaManager.onPeerStream;
    },
    set onPeerStream(handler) {
      mediaManager.onPeerStream = handler;
    },
    get onPeerTrack() {
      return mediaManager.onPeerTrack;
    },
    set onPeerTrack(handler) {
      mediaManager.onPeerTrack = handler;
    }
  };
};

// node_modules/@trystero-p2p/core/dist/shared-peer.mjs
var roomFrameVersion = 1;
var roomPresenceFrameVersion = 2;
var wrapRoomFrame = (roomToken, data) => {
  const tokenBytes = encodeBytes(roomToken);
  const frame = new Uint8Array(3 + tokenBytes.byteLength + data.byteLength);
  frame[0] = roomFrameVersion;
  frame[1] = tokenBytes.byteLength >>> 8 & 255;
  frame[2] = tokenBytes.byteLength & 255;
  frame.set(tokenBytes, 3);
  frame.set(data, 3 + tokenBytes.byteLength);
  return frame;
};
var wrapRoomPresenceFrame = (roomToken, isPresent) => {
  const tokenBytes = encodeBytes(roomToken);
  const frame = new Uint8Array(4 + tokenBytes.byteLength);
  frame[0] = roomPresenceFrameVersion;
  frame[1] = Number(isPresent);
  frame[2] = tokenBytes.byteLength >>> 8 & 255;
  frame[3] = tokenBytes.byteLength & 255;
  frame.set(tokenBytes, 4);
  return frame;
};
var decodeRoomTokenHeader = (buffer, offset) => {
  if (buffer.byteLength < offset + 2) return null;
  const tokenSize = (buffer[offset] ?? 0) << 8 | (buffer[offset + 1] ?? 0);
  const headerSize = offset + 2 + tokenSize;
  if (tokenSize <= 0 || tokenSize > 128 || buffer.byteLength < headerSize) return null;
  return {
    roomToken: decodeBytes(buffer.subarray(offset + 2, headerSize)),
    headerSize
  };
};
var unwrapFrame = (data) => {
  const buffer = new Uint8Array(data);
  if (buffer.byteLength < 3 || buffer.byteLength > 16515) return null;
  if (buffer[0] === roomFrameVersion) {
    const header = decodeRoomTokenHeader(buffer, 1);
    return header ? {
      type: "room",
      roomToken: header.roomToken,
      payload: buffer.subarray(header.headerSize).slice().buffer
    } : null;
  }
  if (buffer[0] === roomPresenceFrameVersion) {
    const header = decodeRoomTokenHeader(buffer, 2);
    return header ? {
      type: "presence",
      roomToken: header.roomToken,
      isPresent: buffer[1] === 1
    } : null;
  }
  return null;
};
var isPeerUnderlyingStale = (peer) => {
  const { connection, channel } = peer;
  return peer.isDead || connection.connectionState === "closed" || connection.connectionState === "failed" || connection.iceConnectionState === "closed" || connection.iceConnectionState === "failed" || channel?.readyState === "closing" || channel?.readyState === "closed";
};
var getConnectedPeerHealth = (peer) => {
  if (isPeerUnderlyingStale(peer)) return "stale";
  const { channel } = peer;
  if (!channel || channel.readyState !== "open") return "transient";
  return "live";
};
var SharedPeerManager = class {
  rooms = /* @__PURE__ */ new Map();
  unclaimedDataTimers = /* @__PURE__ */ new WeakMap();
  pendingDataTimers = /* @__PURE__ */ new WeakMap();
  byApp = {};
  registerRoom(appId, roomId, tokenPromise, options) {
    const rooms = this.rooms.get(appId) ?? /* @__PURE__ */ new Map();
    if (rooms.has(roomId)) throw mkErr("room membership already registered");
    const registration = {
      token: null,
      tokenPromise,
      ...options
    };
    rooms.set(roomId, registration);
    this.rooms.set(appId, rooms);
    const current = () => this.rooms.get(appId)?.get(roomId) === registration;
    const advertise = (present) => {
      if (!registration.token) return;
      for (const shared of values(this.byApp[appId] ?? {})) try {
        this.sendRoomPresence(shared, registration.token, present);
      } catch {
      }
    };
    tokenPromise.then((token) => {
      if (!current()) return;
      registration.token = token;
      for (const shared of values(this.byApp[appId] ?? {})) {
        if (shared.remoteRoomTokens.has(token)) this.attachRoom(appId, roomId, registration, shared);
        this.discardUnboundData(shared);
      }
      if (current() && registration.active) advertise(true);
    });
    return {
      connect: (peerId, peer, idleMs) => {
        if (!current()) {
          peer.destroy();
          return;
        }
        const existing = this.reusable(appId, peerId);
        if (existing && existing.peer !== peer) peer.destroy();
        const shared = existing ?? this.register(appId, peerId, peer, idleMs);
        this.attachRoom(appId, roomId, registration, shared);
        if (!existing) {
          for (const room of rooms.values()) if (room.active && room.token) this.sendRoomPresence(shared, room.token, true);
        }
      },
      reuse: (peerId) => {
        if (!current()) return false;
        const shared = this.reusable(appId, peerId);
        if (!shared) return false;
        this.attachRoom(appId, roomId, registration, shared);
        return true;
      },
      setActive: (active) => {
        if (!current() || registration.active === active) return;
        registration.active = active;
        advertise(active);
      },
      leave: () => {
        if (!current()) return;
        rooms.delete(roomId);
        if (!rooms.size) this.rooms.delete(appId);
        advertise(false);
        for (const shared of values(this.byApp[appId] ?? {})) {
          const binding = shared.bindings[roomId];
          binding?.handlers.close?.();
          binding?.detach();
          this.discardUnboundData(shared);
        }
      }
    };
  }
  owns(appId, peerId, peer) {
    return this.byApp[appId]?.[peerId]?.peer === peer;
  }
  reusable(appId, peerId) {
    const shared = this.byApp[appId]?.[peerId];
    if (shared && isPeerUnderlyingStale(shared.peer)) {
      this.clear(appId, peerId, { destroyPeer: true });
      return;
    }
    return shared;
  }
  attachRoom(appId, roomId, registration, shared) {
    if (this.rooms.get(appId)?.get(roomId) !== registration || shared.isClosing || this.get(appId, shared.peerId) !== shared) return;
    const { proxy, isNew } = this.bind(roomId, registration.tokenPromise, shared, { onDetach: () => registration.onDetach(shared.peerId, shared.peer) });
    if (isNew) registration.onPeer(proxy, shared.peerId, shared.peer);
  }
  get(appId, peerId) {
    return this.byApp[appId]?.[peerId];
  }
  sendRoomPresence(shared, roomToken, isPresent) {
    if (shared.isClosing || isPeerUnderlyingStale(shared.peer)) return;
    shared.peer.sendData(wrapRoomPresenceFrame(roomToken, isPresent));
  }
  clear(appId, peerId, { destroyPeer }) {
    const map = this.byApp[appId];
    const shared = map?.[peerId];
    if (!shared || shared.isClosing) return;
    shared.idleTimer = resetTimer(shared.idleTimer);
    this.clearDataTimers(shared);
    shared.isClosing = true;
    if (destroyPeer && !shared.peer.isDead) shared.peer.destroy();
    const bindings = values(shared.bindings);
    shared.bindings = {};
    shared.bindingsByToken = {};
    shared.controlRoomId = null;
    delete map[peerId];
    bindings.forEach((binding) => {
      binding.handlers.close?.();
      binding.pendingData.length = 0;
      binding.pendingSendData.length = 0;
      binding.pendingTracks.length = 0;
    });
    shared.media.clearRemote();
    shared.pendingDataByToken.clear();
    shared.remoteRoomTokens.clear();
    if (keys(map).length === 0) delete this.byApp[appId];
  }
  register(appId, peerId, peer, idleMs) {
    const existing = this.byApp[appId]?.[peerId];
    if (existing) {
      existing.idleTimer = resetTimer(existing.idleTimer);
      if (existing.peer === peer) return existing;
      this.clear(appId, peerId, { destroyPeer: true });
    }
    const shared = {
      appId,
      peerId,
      peer,
      bindings: {},
      bindingsByToken: {},
      pendingDataByToken: /* @__PURE__ */ new Map(),
      remoteRoomTokens: /* @__PURE__ */ new Set(),
      idleTimer: null,
      controlRoomId: null,
      streamOwners: /* @__PURE__ */ new Map(),
      trackOwners: /* @__PURE__ */ new Map(),
      media: createMediaIdentityCache(),
      idleMs,
      isClosing: false
    };
    (this.byApp[appId] ??= {})[peerId] = shared;
    const clearCurrent = () => {
      if (this.owns(appId, peerId, peer)) this.clear(appId, peerId, { destroyPeer: true });
    };
    peer.setHandlers({
      data: (data) => this.dispatchData(shared, data),
      signal: (signal) => this.dispatchSignal(shared, signal),
      close: clearCurrent,
      error: (err) => {
        console.error(`${libName} peer error:`, err);
        clearCurrent();
      },
      track: (track, stream) => this.dispatchTrack(shared, track, stream)
    });
    return shared;
  }
  bind(roomId, roomTokenPromise, shared, { onDetach }) {
    const existingBinding = shared.bindings[roomId];
    if (existingBinding) {
      shared.idleTimer = resetTimer(shared.idleTimer);
      return {
        proxy: existingBinding.proxy,
        isNew: false
      };
    }
    const binding = {
      roomId,
      roomToken: null,
      roomTokenPromise,
      handlers: {},
      pendingData: [],
      pendingSendData: [],
      pendingTracks: [],
      detach: noOp,
      proxy: {}
    };
    const detachBinding = () => {
      if (shared.bindings[roomId] !== binding) return;
      const shouldDestroy = keys(shared.bindings).length === 1 && (shared.streamOwners.size > 0 || shared.trackOwners.size > 0 || shared.media.hasRemoteMedia());
      if (!shouldDestroy) this.pruneRoomOwnership(shared, roomId);
      delete shared.bindings[roomId];
      if (binding.roomToken && shared.bindingsByToken[binding.roomToken] === binding) delete shared.bindingsByToken[binding.roomToken];
      if (shared.controlRoomId === roomId) shared.controlRoomId = keys(shared.bindings)[0] ?? null;
      this.discardUnboundData(shared);
      onDetach();
      if (shouldDestroy) this.clear(shared.appId, shared.peerId, { destroyPeer: true });
      else this.scheduleIdleTimer(shared);
    };
    const proxy = {
      get connection() {
        return shared.peer.connection;
      },
      get channel() {
        return shared.peer.channel;
      },
      get isDead() {
        return shared.peer.isDead;
      },
      getOffer: (restartIce) => shared.peer.getOffer(restartIce),
      signal: (sdp) => shared.peer.signal(sdp),
      sendData: (data) => {
        if (!binding.roomToken) {
          binding.pendingSendData.push(data);
          return;
        }
        shared.peer.sendData(wrapRoomFrame(binding.roomToken, data));
      },
      destroy: () => detachBinding(),
      setHandlers: (newHandlers) => {
        Object.assign(binding.handlers, newHandlers);
        this.flushBindingQueues(shared, binding);
      },
      addStream: (stream) => {
        const owners = shared.streamOwners.get(stream) ?? /* @__PURE__ */ new Set();
        const shouldAttach = owners.size === 0;
        owners.add(roomId);
        shared.streamOwners.set(stream, owners);
        if (shouldAttach) shared.peer.addStream(stream);
      },
      removeStream: (stream) => this.releaseStreamOwner(shared, stream, roomId),
      addTrack: (track, stream) => {
        const entry = shared.trackOwners.get(track) ?? {
          stream,
          rooms: /* @__PURE__ */ new Set()
        };
        const shouldAttach = entry.rooms.size === 0;
        entry.stream = stream;
        entry.rooms.add(roomId);
        shared.trackOwners.set(track, entry);
        if (shouldAttach) return shared.peer.addTrack(track, stream);
        return shared.peer.connection.getSenders().find((s) => s.track === track) ?? shared.peer.addTrack(track, stream);
      },
      removeTrack: (track) => this.releaseTrackOwner(shared, track, roomId),
      replaceTrack: async (oldTrack, newTrack) => {
        const oldEntry = shared.trackOwners.get(oldTrack);
        await shared.peer.replaceTrack(oldTrack, newTrack);
        if (oldEntry && shared.trackOwners.get(oldTrack) === oldEntry) {
          shared.trackOwners.delete(oldTrack);
          const nextEntry = shared.trackOwners.get(newTrack) ?? {
            stream: oldEntry.stream,
            rooms: /* @__PURE__ */ new Set()
          };
          oldEntry.rooms.forEach((room) => nextEntry.rooms.add(room));
          shared.trackOwners.set(newTrack, nextEntry);
        }
      },
      __trysteroMedia: shared.media
    };
    binding.proxy = proxy;
    binding.detach = detachBinding;
    shared.bindings[roomId] = binding;
    shared.controlRoomId ??= roomId;
    shared.idleTimer = resetTimer(shared.idleTimer);
    roomTokenPromise.then((roomToken) => {
      if (shared.isClosing || shared.bindings[roomId] !== binding) return;
      binding.roomToken = roomToken;
      shared.bindingsByToken[roomToken] = binding;
      const pendingData = shared.pendingDataByToken.get(roomToken);
      if (pendingData?.length) {
        binding.pendingData.push(...pendingData);
        shared.pendingDataByToken.delete(roomToken);
      }
      const pendingSendData = binding.pendingSendData.splice(0);
      if (!isPeerUnderlyingStale(shared.peer)) pendingSendData.forEach((payload) => {
        try {
          shared.peer.sendData(wrapRoomFrame(roomToken, payload));
        } catch {
        }
      });
      this.flushBindingQueues(shared, binding);
      this.discardUnboundData(shared);
    });
    return {
      proxy,
      isNew: true
    };
  }
  releaseStreamOwner(shared, stream, roomIdToRemove) {
    const rooms = shared.streamOwners.get(stream);
    if (!rooms) return;
    rooms.delete(roomIdToRemove);
    if (rooms.size === 0) {
      shared.streamOwners.delete(stream);
      shared.peer.removeStream(stream);
    }
  }
  releaseTrackOwner(shared, track, roomIdToRemove) {
    const entry = shared.trackOwners.get(track);
    if (!entry) return;
    entry.rooms.delete(roomIdToRemove);
    if (entry.rooms.size === 0) {
      shared.trackOwners.delete(track);
      shared.peer.removeTrack(track);
    }
  }
  pruneRoomOwnership(shared, roomIdToRemove) {
    shared.streamOwners.forEach((_, stream) => this.releaseStreamOwner(shared, stream, roomIdToRemove));
    shared.trackOwners.forEach((_, track) => this.releaseTrackOwner(shared, track, roomIdToRemove));
  }
  scheduleIdleTimer(shared) {
    if (shared.isClosing || keys(shared.bindings).length > 0) return;
    shared.idleTimer = resetTimer(shared.idleTimer);
    shared.idleTimer = setTimeout(() => {
      const current = this.byApp[shared.appId]?.[shared.peerId];
      if (!current || keys(current.bindings).length > 0) return;
      this.clear(shared.appId, shared.peerId, { destroyPeer: true });
    }, shared.idleMs);
  }
  getSignalBinding(shared) {
    if (shared.controlRoomId) {
      const selected = shared.bindings[shared.controlRoomId];
      if (selected?.handlers.signal) return selected;
    }
    const fallback = values(shared.bindings).find((binding) => Boolean(binding.handlers.signal));
    if (!fallback) return null;
    shared.controlRoomId = fallback.roomId;
    return fallback;
  }
  flushBindingQueues(shared, binding) {
    const { handlers } = binding;
    if (handlers.data && binding.pendingData.length > 0) {
      const queued = binding.pendingData.splice(0);
      this.syncDataTimers(shared);
      queued.forEach((payload) => handlers.data?.(payload));
    } else this.syncDataTimers(shared);
    if ((handlers.track || handlers.stream) && binding.pendingTracks.length) binding.pendingTracks.splice(0).forEach(({ track, stream }) => {
      handlers.track?.(track, stream);
      handlers.stream?.(stream);
    });
  }
  unclaimedBufferedFrameCount(shared) {
    let count = 0;
    for (const queue of shared.pendingDataByToken.values()) count += queue.length;
    return count;
  }
  boundBufferedFrameCount(shared) {
    let count = 0;
    for (const binding of values(shared.bindings)) count += binding.pendingData.length;
    return count;
  }
  bufferedFrameCount(shared) {
    return this.unclaimedBufferedFrameCount(shared) + this.boundBufferedFrameCount(shared);
  }
  clearDataTimers(shared) {
    resetTimer(this.unclaimedDataTimers.get(shared));
    this.unclaimedDataTimers.delete(shared);
    resetTimer(this.pendingDataTimers.get(shared));
    this.pendingDataTimers.delete(shared);
  }
  syncDataTimers(shared) {
    if (shared.isClosing) {
      this.clearDataTimers(shared);
      return;
    }
    if (this.unclaimedBufferedFrameCount(shared) === 0) {
      resetTimer(this.unclaimedDataTimers.get(shared));
      this.unclaimedDataTimers.delete(shared);
    } else if (!this.unclaimedDataTimers.has(shared)) this.unclaimedDataTimers.set(shared, setTimeout(() => {
      this.unclaimedDataTimers.delete(shared);
      shared.pendingDataByToken.clear();
    }, pendingDataTimeoutMs));
    if (this.boundBufferedFrameCount(shared) === 0) {
      resetTimer(this.pendingDataTimers.get(shared));
      this.pendingDataTimers.delete(shared);
    } else if (!this.pendingDataTimers.has(shared)) this.pendingDataTimers.set(shared, setTimeout(() => {
      this.pendingDataTimers.delete(shared);
      if (this.boundBufferedFrameCount(shared) > 0) this.failData(shared, "room data handler timed out");
    }, pendingDataTimeoutMs));
  }
  canBindRoomToken(shared, token) {
    return values(shared.bindings).some((binding) => !binding.roomToken) || [...this.rooms.get(shared.appId)?.values() ?? []].some((room) => !room.token || room.token === token);
  }
  discardUnboundData(shared) {
    for (const token of shared.pendingDataByToken.keys()) if (!this.canBindRoomToken(shared, token)) shared.pendingDataByToken.delete(token);
    this.syncDataTimers(shared);
  }
  failData(shared, reason) {
    console.warn(`${libName}: ${reason}; disconnecting peer ${shared.peerId}`);
    this.clear(shared.appId, shared.peerId, { destroyPeer: true });
  }
  dispatchData(shared, data) {
    if (shared.isClosing) return;
    const decoded = unwrapFrame(data);
    if (!decoded) {
      this.failData(shared, "invalid or incompatible room frame");
      return;
    }
    if (decoded.type === "presence") {
      if (decoded.isPresent) {
        if (!shared.remoteRoomTokens.has(decoded.roomToken) && shared.remoteRoomTokens.size >= 64) {
          this.failData(shared, "too many advertised rooms");
          return;
        }
        shared.remoteRoomTokens.add(decoded.roomToken);
        for (const [roomId, registration] of this.rooms.get(shared.appId) ?? []) if (registration.token === decoded.roomToken) this.attachRoom(shared.appId, roomId, registration, shared);
      } else {
        shared.remoteRoomTokens.delete(decoded.roomToken);
        shared.pendingDataByToken.delete(decoded.roomToken);
        const binding2 = shared.bindingsByToken[decoded.roomToken];
        binding2?.handlers.close?.();
        binding2?.detach();
        this.syncDataTimers(shared);
      }
      return;
    }
    const binding = shared.bindingsByToken[decoded.roomToken];
    if (!binding) {
      if (!this.canBindRoomToken(shared, decoded.roomToken) || this.bufferedFrameCount(shared) >= 64) return;
      const pending = shared.pendingDataByToken.get(decoded.roomToken) ?? [];
      pending.push(decoded.payload);
      shared.pendingDataByToken.set(decoded.roomToken, pending);
      this.syncDataTimers(shared);
      return;
    }
    if (binding.handlers.data) binding.handlers.data(decoded.payload);
    else {
      if (this.bufferedFrameCount(shared) >= 64) {
        this.failData(shared, "too much data waiting for a room handler");
        return;
      }
      binding.pendingData.push(decoded.payload);
      this.syncDataTimers(shared);
    }
  }
  dispatchSignal(shared, signal) {
    const binding = this.getSignalBinding(shared);
    if (binding) binding.handlers.signal?.(signal);
    else if (signal.type === "offer") this.clear(shared.appId, shared.peerId, { destroyPeer: true });
  }
  dispatchTrack(shared, track, stream) {
    values(shared.bindings).forEach((binding) => {
      if (binding.handlers.track || binding.handlers.stream) {
        binding.handlers.track?.(track, stream);
        binding.handlers.stream?.(stream);
        return;
      }
      binding.pendingTracks.push({
        track,
        stream
      });
    });
  }
};

// node_modules/@trystero-p2p/core/dist/signal-handler.mjs
var offerPostAnswerTtlMs = 23333;
var offerTtl = 57333;
var offerIdSize = 12;
var disconnectedPeerGraceMs = 7533;
var answeringTtlMs = 23333;
var offerRelayPlaceholder = "offer-placeholder";
var signalKeys = [
  "offer",
  "answer",
  "candidate"
];
var toPayload = (msg) => {
  if (typeof msg === "string") try {
    const parsed = fromJson(msg);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
  return msg && typeof msg === "object" && !Array.isArray(msg) ? msg : null;
};
var getString = (payload, key) => typeof payload[key] === "string" && payload[key] ? payload[key] : void 0;
var isPeerHandle = (value) => Boolean(value && typeof value === "object" && typeof value.signal === "function" && typeof value.destroy === "function" && typeof value.setHandlers === "function");
var hasInvalidSignalField = (payload, isStringMessage = false) => signalKeys.some((key) => key in payload && (typeof payload[key] !== "string" || payload[key] === "")) || "peer" in payload && (isStringMessage || payload["peer"] !== void 0 && !isPeerHandle(payload["peer"]));
var publishCipheredSignalingMessage = (ctx, signal, peerTopic, signalPeer, buildPayload, stillValid) => {
  ctx.toCipher(signal).then((encryptedSignal) => {
    if (ctx.isLeaving() || !stillValid()) return;
    signalPeer(peerTopic, toJson(buildPayload(encryptedSignal.sdp)));
  });
};
var makeState = () => ({
  offerPeer: null,
  offerId: null,
  offerSdp: null,
  offerInitPromise: null,
  offerAnswered: false,
  offerRelays: [],
  offerSignalRelays: [],
  offerSignalBacklog: [],
  offerRelayTimers: [],
  offerExpiryTimer: null,
  connectedPeer: null,
  connectedPeerUnhealthySinceMs: null,
  answeringExpiryTimer: null,
  answeringPeer: null,
  answerSent: false,
  answerReplay: null,
  connectionErrorReported: false
});
var hasTurnServer = (config) => {
  return [...config.turnConfig ?? [], ...config.rtcConfig?.iceServers ?? []].some(({ urls }) => {
    return (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
  });
};
var getSdpExchangeConnectionError = (peerId, config) => `could not connect to peer ${peerId} after exchanging SDP; ${hasTurnServer(config) ? "check that your TURN server URLs and credentials are reachable by both peers" : "configure TURN servers with turnConfig or rtcConfig.iceServers"}`;
var reportSdpExchangeConnectionFailure = (ctx, state, peerId) => {
  if (ctx.isLeaving() || state.connectedPeer || state.connectionErrorReported) return;
  state.connectionErrorReported = true;
  ctx.onJoinError?.({
    error: getSdpExchangeConnectionError(peerId, ctx.config),
    appId: ctx.appId,
    peerId,
    roomId: ctx.roomId
  });
};
var getState = (peerStates, peerId) => peerStates[peerId] ??= makeState();
var counterAnnounceTimestamps = /* @__PURE__ */ new WeakMap();
var resetAnsweringState = (state) => {
  counterAnnounceTimestamps.delete(state);
  state.answeringExpiryTimer = resetTimer(state.answeringExpiryTimer);
  state.answeringPeer = null;
  state.answerSent = false;
  state.answerReplay = null;
};
var clearAnswering = (state, peer) => {
  if (state.answeringPeer === peer) {
    resetAnsweringState(state);
    if (state.connectedPeer !== peer && !peer.isDead) peer.destroy();
  }
};
var markPeerConnected = (state, physical) => {
  if (state.answeringPeer && state.answeringPeer !== physical && !state.answeringPeer.isDead) state.answeringPeer.destroy();
  resetAnsweringState(state);
  state.connectedPeer = physical;
  state.connectedPeerUnhealthySinceMs = null;
};
var detachConnectedPeer = (state, physical) => {
  if (state?.connectedPeer === physical) {
    state.connectedPeer = null;
    state.connectedPeerUnhealthySinceMs = null;
  }
};
var clearConnectedPeer = (state, peerId, _reason) => {
  if (!state.connectedPeer) return;
  if (!state.connectedPeer.isDead) state.connectedPeer.destroy();
  state.connectedPeer = null;
  state.connectedPeerUnhealthySinceMs = null;
};
var clearOfferRelay = (state, relayId) => {
  state.offerRelayTimers[relayId] = resetTimer(state.offerRelayTimers[relayId]);
  if (state.offerRelays[relayId]) state.offerRelays[relayId] = void 0;
};
var clearOfferRelayIfPlaceholder = (state, relayId) => {
  if (state?.offerRelays[relayId] === offerRelayPlaceholder) clearOfferRelay(state, relayId);
};
var resetOfferState = (state) => {
  counterAnnounceTimestamps.delete(state);
  state.offerExpiryTimer = resetTimer(state.offerExpiryTimer);
  state.offerInitPromise = null;
  state.offerRelays.forEach((_, relayId) => clearOfferRelay(state, relayId));
  state.offerRelays = [];
  state.offerSignalRelays = [];
  state.offerRelayTimers = [];
  state.offerSignalBacklog = [];
  if (state.offerPeer && state.offerPeer !== state.connectedPeer) {
    if (!state.offerPeer.isDead) state.offerPeer.destroy();
  }
  state.offerPeer = null;
  state.offerId = null;
  state.offerSdp = null;
  state.offerAnswered = false;
  state.connectionErrorReported = false;
};
var scheduleAnsweringExpiry = (ctx, state, peerId, peer) => {
  resetTimer(state.answeringExpiryTimer);
  state.answeringExpiryTimer = setTimeout(() => {
    const current = ctx.peerStates[peerId];
    if (!current || current.connectedPeer || current.answeringPeer !== peer) return;
    if (current.answerSent) reportSdpExchangeConnectionFailure(ctx, current, peerId);
    clearAnswering(current, peer);
    ctx.checkDeactivate();
  }, answeringTtlMs);
};
var scheduleOfferExpiry = (ctx, state, peerId, ttlMs = offerTtl) => {
  resetTimer(state.offerExpiryTimer);
  const offerId = state.offerId;
  state.offerExpiryTimer = setTimeout(() => {
    const current = ctx.peerStates[peerId];
    if (!current || current.connectedPeer || current.offerId !== offerId) return;
    if (current.offerAnswered) reportSdpExchangeConnectionFailure(ctx, current, peerId);
    resetOfferState(current);
    ctx.checkDeactivate();
  }, ttlMs);
};
var bindOfferPeerHandlers = (ctx, state, peerId, peer, onSignal) => {
  const onOfferPeerClosedOrError = () => {
    if (state.offerPeer === peer && !state.connectedPeer) {
      if (state.offerAnswered) reportSdpExchangeConnectionFailure(ctx, state, peerId);
      resetOfferState(state);
    }
    ctx.disconnectPeer(peer, peerId);
    ctx.checkDeactivate();
  };
  peer.setHandlers({
    connect: () => ctx.connectPeer(peer, peerId),
    ...onSignal ? { signal: onSignal } : {},
    close: onOfferPeerClosedOrError,
    error: onOfferPeerClosedOrError
  });
};
var ensureOffer = (ctx, state, peerId) => {
  if (state.offerPeer && state.offerId && state.offerSdp) return Promise.resolve({
    peer: state.offerPeer,
    offer: state.offerSdp,
    offerId: state.offerId
  });
  if (state.offerInitPromise) return state.offerInitPromise;
  const allocateOffer = async () => {
    let firstOffer;
    try {
      firstOffer = (await ctx.offerManager.checkout(1, false, ctx.encryptOffer))[0];
    } catch (error) {
      if (ctx.isLeaving() || state.offerInitPromise !== pending) return null;
      throw error;
    }
    if (!firstOffer) throw mkErr("failed to allocate offer peer");
    const { peer, offer: offer2 } = firstOffer;
    if (ctx.isLeaving() || state.offerInitPromise !== pending) {
      peer.destroy();
      return null;
    }
    state.offerPeer = peer;
    state.offerId = genId(offerIdSize);
    state.offerSdp = offer2;
    state.offerAnswered = false;
    state.connectionErrorReported = false;
    state.offerSignalBacklog = [];
    bindOfferPeerHandlers(ctx, state, peerId, peer, (signal) => {
      if (state.offerPeer !== peer) return;
      state.offerSignalBacklog.push(signal);
      state.offerSignalRelays.forEach((sendSignal) => sendSignal?.(signal));
    });
    scheduleOfferExpiry(ctx, state, peerId);
    return {
      peer,
      offer: offer2,
      offerId: state.offerId
    };
  };
  const pending = allocateOffer().finally(() => {
    if (state.offerInitPromise === pending) state.offerInitPromise = null;
  });
  return state.offerInitPromise = pending;
};
var handleAnnouncement = async (ctx, relayId, peerId, signalPeer, retryAttempt = 0) => {
  const state = ctx.peerStates[peerId];
  if (!state || state.connectedPeer || state.answeringPeer || state.offerAnswered) {
    clearOfferRelayIfPlaceholder(state, relayId);
    return;
  }
  if (state.offerRelays[relayId] !== offerRelayPlaceholder) return;
  const [peerTopic, offerInfo] = await all([sha1(topicPath(ctx.rootTopicPlaintext, peerId)), ensureOffer(ctx, state, peerId)]);
  if (!offerInfo) {
    clearOfferRelayIfPlaceholder(state, relayId);
    return;
  }
  if (ctx.isLeaving()) {
    resetOfferState(state);
    return;
  }
  if (state.connectedPeer || state.answeringPeer || state.offerAnswered || state.offerRelays[relayId] !== offerRelayPlaceholder) {
    clearOfferRelayIfPlaceholder(state, relayId);
    return;
  }
  state.offerRelayTimers[relayId] = resetTimer(state.offerRelayTimers[relayId]);
  state.offerRelays[relayId] = true;
  state.offerRelayTimers[relayId] = setTimeout(() => {
    if (retryAttempt >= 2 || ctx.isLeaving() || state.connectedPeer || state.answeringPeer || state.offerAnswered || state.offerPeer !== offerInfo.peer || state.offerId !== offerInfo.offerId) {
      prunePendingOffer(ctx, peerId, relayId);
      return;
    }
    state.offerRelays[relayId] = offerRelayPlaceholder;
    handleAnnouncement(ctx, relayId, peerId, signalPeer, retryAttempt + 1);
  }, retryAttempt === 0 && ctx.announceIntervals[relayId] === void 0 ? 2e3 : (ctx.announceIntervals[relayId] ?? ctx.announceIntervalMs) * 0.9);
  let didSendOffer = false;
  state.offerSignalRelays[relayId] = (signal) => {
    if (!didSendOffer) return;
    if (ctx.isLeaving() || state.connectedPeer || state.offerPeer !== offerInfo.peer || state.offerId !== offerInfo.offerId || signal.type !== "candidate") return;
    publishCipheredSignalingMessage(ctx, signal, peerTopic, signalPeer, (sdp) => ({
      peerId: selfId,
      offerId: offerInfo.offerId,
      candidate: sdp,
      ...ctx.isPassive ? { passive: true } : {}
    }), () => !state.connectedPeer && state.offerPeer === offerInfo.peer && state.offerId === offerInfo.offerId);
  };
  signalPeer(peerTopic, toJson({
    peerId: selfId,
    offerId: offerInfo.offerId,
    offer: offerInfo.offer,
    ...ctx.isPassive ? { passive: true } : {}
  }));
  didSendOffer = true;
  state.offerSignalBacklog.forEach((signal) => state.offerSignalRelays[relayId]?.(signal));
};
var handleOffer = async (ctx, relayId, peerId, offer2, offerId, signalPeer) => {
  const state = getState(ctx.peerStates, peerId);
  if (state.answeringPeer || state.offerAnswered) {
    const replay2 = state.answerReplay;
    const lastSentAt = replay2?.lastSentAt[relayId];
    if (state.answeringPeer && !state.answeringPeer.isDead && replay2 && replay2.offer === offer2 && replay2.offerId === offerId && (lastSentAt === void 0 || Date.now() - lastSentAt >= 1e3)) {
      replay2.lastSentAt[relayId] = Date.now();
      const peerTopic2 = await sha1(topicPath(ctx.rootTopicPlaintext, peerId));
      if (!ctx.isLeaving() && state.answerReplay === replay2 && !state.connectedPeer) {
        const send2 = (message) => signalPeer(peerTopic2, message);
        replay2.relays[relayId] = send2;
        replay2.messages.forEach(send2);
      }
    }
    return;
  }
  const hasTrackedOutgoingOffer = Boolean(state.offerPeer || state.offerRelays.some(Boolean));
  if (hasTrackedOutgoingOffer && selfId < peerId) return;
  if (hasTrackedOutgoingOffer) resetOfferState(state);
  const answerPeer = ctx.initPeer(false, ctx.config);
  const replay = {
    offer: offer2,
    offerId,
    messages: [],
    lastSentAt: [],
    relays: []
  };
  replay.lastSentAt[relayId] = Date.now();
  state.answeringPeer = answerPeer;
  state.answerSent = false;
  state.answerReplay = replay;
  state.connectionErrorReported = false;
  scheduleAnsweringExpiry(ctx, state, peerId, answerPeer);
  const onAnswerPeerClosedOrError = () => {
    if (state.answeringPeer === answerPeer && !state.connectedPeer && state.answerSent) reportSdpExchangeConnectionFailure(ctx, state, peerId);
    clearAnswering(state, answerPeer);
    ctx.disconnectPeer(answerPeer, peerId);
    ctx.checkDeactivate();
  };
  answerPeer.setHandlers({
    connect: () => ctx.connectPeer(answerPeer, peerId),
    close: onAnswerPeerClosedOrError,
    error: onAnswerPeerClosedOrError
  });
  let plainOffer;
  try {
    plainOffer = await ctx.toPlain({
      type: "offer",
      sdp: offer2
    });
  } catch {
    clearAnswering(state, answerPeer);
    ctx.onJoinError?.({
      error: "incorrect room password when decrypting offer",
      appId: ctx.appId,
      peerId,
      roomId: ctx.roomId
    });
    return;
  }
  if (answerPeer.isDead) {
    clearAnswering(state, answerPeer);
    return;
  }
  const peerTopic = await sha1(topicPath(ctx.rootTopicPlaintext, peerId));
  if (ctx.isLeaving() || state.answerReplay !== replay) return;
  replay.relays[relayId] = (message) => signalPeer(peerTopic, message);
  const pendingCandidates = [];
  let didSendAnswer = false;
  const publishAnswerSignal = (signal) => {
    ctx.toCipher(signal).then((encryptedSignal) => {
      if (ctx.isLeaving() || state.answeringPeer !== answerPeer || answerPeer.isDead) return;
      const payloadToSend = { peerId: selfId };
      if (signal.type === "answer") {
        state.answerSent = true;
        payloadToSend["answer"] = encryptedSignal.sdp;
      } else payloadToSend["candidate"] = encryptedSignal.sdp;
      if (offerId) payloadToSend["offerId"] = offerId;
      if (ctx.isPassive) payloadToSend["passive"] = true;
      const message = toJson(payloadToSend);
      const now = Date.now();
      replay.messages.push(message);
      replay.relays.forEach((send2, id) => {
        if (send2) {
          replay.lastSentAt[id] = now;
          send2(message);
        }
      });
      if (signal.type === "answer" && !didSendAnswer) {
        didSendAnswer = true;
        pendingCandidates.splice(0).forEach(publishAnswerSignal);
      }
    });
  };
  answerPeer.setHandlers({ signal: (signal) => {
    if (ctx.isLeaving() || state.answeringPeer !== answerPeer || answerPeer.isDead) return;
    if (signal.type !== "answer" && signal.type !== "candidate") return;
    if (signal.type === "candidate" && !didSendAnswer) {
      pendingCandidates.push(signal);
      return;
    }
    publishAnswerSignal(signal);
  } });
  await answerPeer.signal(plainOffer);
};
var handleCandidate = async (ctx, peerId, candidate, offerId, peer) => {
  let plainCandidate;
  try {
    plainCandidate = await ctx.toPlain({
      type: candidateType,
      sdp: candidate
    });
  } catch {
    return;
  }
  const state = ctx.peerStates[peerId];
  const offerPeerMatch = offerId && state?.offerPeer && state.offerId === offerId ? state.offerPeer : null;
  const answeringPeer = !offerId || state?.answerReplay?.offerId === offerId ? state?.answeringPeer : null;
  const fallbackOfferPeer = !offerId && state?.offerPeer ? state.offerPeer : null;
  const targetPeer = peer && !peer.isDead ? peer : offerPeerMatch ?? answeringPeer ?? fallbackOfferPeer;
  if (targetPeer && !targetPeer.isDead) targetPeer.signal(plainCandidate);
};
var handleAnswer = async (ctx, peerId, answer, offerId, peer) => {
  let plainAnswer;
  try {
    plainAnswer = await ctx.toPlain({
      type: "answer",
      sdp: answer
    });
  } catch {
    if (peer) {
      ctx.offerManager.reclaimLeased(peer);
      if (!peer.isDead) peer.destroy();
    }
    ctx.onJoinError?.({
      error: "incorrect room password when decrypting answer",
      appId: ctx.appId,
      peerId,
      roomId: ctx.roomId
    });
    return;
  }
  if (peer) {
    const state = getState(ctx.peerStates, peerId);
    ctx.offerManager.claimLeased(peer);
    if (state.connectedPeer || state.offerAnswered || state.answeringPeer && !state.answeringPeer.isDead && selfId > peerId) {
      peer.destroy();
      return;
    }
    if (state.answeringPeer) {
      const answeringPeer = state.answeringPeer;
      clearAnswering(state, answeringPeer);
    }
    resetOfferState(state);
    state.offerPeer = peer;
    state.offerId = offerId ?? null;
    state.offerAnswered = true;
    scheduleOfferExpiry(ctx, state, peerId, offerPostAnswerTtlMs);
    bindOfferPeerHandlers(ctx, state, peerId, peer);
    peer.signal(plainAnswer);
  } else {
    const state = ctx.peerStates[peerId];
    if (!state || !state.offerPeer || state.offerAnswered || offerId && state.offerId && offerId !== state.offerId || state.offerPeer.isDead) return;
    state.offerAnswered = true;
    scheduleOfferExpiry(ctx, state, peerId, offerPostAnswerTtlMs);
    state.offerPeer.signal(plainAnswer);
  }
};
var prunePendingOffer = (ctx, peerId, relayId) => {
  const state = ctx.peerStates[peerId];
  if (!state || state.connectedPeer) return;
  if (state.offerRelays[relayId]) {
    clearOfferRelay(state, relayId);
    ctx.checkDeactivate();
  }
};
var createSignalHandler = (ctx) => (relayId) => async (topic, msg, signalPeer) => {
  if (ctx.isLeaving()) return;
  const payload = toPayload(msg);
  if (!payload || hasInvalidSignalField(payload, typeof msg === "string")) return;
  const peerId = getString(payload, "peerId") ?? "";
  const offer2 = getString(payload, "offer");
  const answer = getString(payload, "answer");
  const candidate = getString(payload, "candidate");
  const offerId = getString(payload, "offerId");
  const peer = isPeerHandle(payload["peer"]) ? payload["peer"] : void 0;
  const remoteIsPassive = payload["passive"] === true;
  if (!peerId || peerId === selfId) return;
  const [rootTopic, selfTopic] = await all([ctx.rootTopicP, ctx.selfTopicP]);
  if (ctx.isLeaving()) return;
  if (topic !== rootTopic && topic !== selfTopic) return;
  if (ctx.isPassive && remoteIsPassive) return;
  if (ctx.isPassive && !ctx.isActive && !answer && !candidate) {
    ctx.isActive = true;
    ctx.requeueAnnounce?.();
  }
  if (ctx.isPassive && !ctx.isActive) return;
  const state = ctx.peerStates[peerId];
  const connectedPeer = state?.connectedPeer;
  if (connectedPeer && state) {
    const health = getConnectedPeerHealth(connectedPeer);
    if (health === "live") {
      state.connectedPeerUnhealthySinceMs = null;
      return;
    }
    if (health === "stale") clearConnectedPeer(state, peerId, "message-from-stale-peer");
    else {
      const nowMs = Date.now();
      const unhealthySinceMs = state.connectedPeerUnhealthySinceMs ?? nowMs;
      state.connectedPeerUnhealthySinceMs = unhealthySinceMs;
      if (nowMs - unhealthySinceMs < disconnectedPeerGraceMs) return;
      clearConnectedPeer(state, peerId, "message-from-prolonged-disconnect");
    }
  }
  if (ctx.reusePeer(peerId)) return;
  if (Boolean(peerId && !offer2 && !answer && !candidate)) {
    const announcePeerState = getState(ctx.peerStates, peerId);
    const shouldLeadOffer = selfId < peerId;
    if (announcePeerState.answeringPeer || announcePeerState.connectedPeer || announcePeerState.offerAnswered) return;
    if (!shouldLeadOffer && !announcePeerState.offerPeer) {
      let lastSentByRelay = counterAnnounceTimestamps.get(announcePeerState);
      if (!lastSentByRelay) {
        lastSentByRelay = [];
        counterAnnounceTimestamps.set(announcePeerState, lastSentByRelay);
      }
      const lastSentAt = lastSentByRelay[relayId];
      if (lastSentAt !== void 0 && Date.now() - lastSentAt < 1e3) return;
      lastSentByRelay[relayId] = Date.now();
      const peerSelfTopic = await sha1(topicPath(ctx.rootTopicPlaintext, peerId));
      if (!ctx.isLeaving() && !announcePeerState.connectedPeer && !announcePeerState.answeringPeer && !announcePeerState.offerAnswered) signalPeer(peerSelfTopic, toJson({ peerId: selfId }));
      return;
    }
    if (announcePeerState.offerRelays[relayId]) return;
    announcePeerState.offerRelays[relayId] = offerRelayPlaceholder;
    return handleAnnouncement(ctx, relayId, peerId, signalPeer);
  }
  if (offer2) return handleOffer(ctx, relayId, peerId, offer2, offerId, signalPeer);
  if (candidate) return handleCandidate(ctx, peerId, candidate, offerId, peer);
  if (answer) return handleAnswer(ctx, peerId, answer, offerId, peer);
};

// node_modules/@trystero-p2p/core/dist/strategy.mjs
var announceIntervalMs = 5333;
var announceWarmupIntervalsMs = [
  233,
  533,
  1333
];
var passiveActivationGraceMs = 7533;
var sharedPeerIdleMsDefault = 123333;
var strategy_default = ({ init, subscribe, announce, deactivate }) => {
  const occupiedRooms = {};
  const leavingRoomCleanups = {};
  const sharedPeers = new SharedPeerManager();
  const hasActiveRooms = () => values(occupiedRooms).some((rooms) => keys(rooms).length > 0);
  let didInit = false;
  let initPromises = [];
  let cleanupWatchOnline = noOp;
  return (config, roomId, callbacks) => {
    if (!config) throw mkErr("requires a config map as the first argument");
    if (callbacks && typeof callbacks !== "object") throw mkErr("third argument must be a callbacks object");
    const { appId } = config;
    const onJoinError = callbacks?.onJoinError;
    const onPeerHandshake = callbacks?.onPeerHandshake;
    const handshakeTimeoutMs = callbacks?.handshakeTimeoutMs;
    if (!appId) throw mkErr("config map is missing appId field");
    if (!roomId) throw mkErr("roomId argument required");
    if (config.maxReceiveBytes !== void 0 && (!Number.isSafeInteger(config.maxReceiveBytes) || config.maxReceiveBytes <= 0)) throw mkErr("maxReceiveBytes must be a positive safe integer");
    if (handshakeTimeoutMs !== void 0 && (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0)) throw mkErr("handshakeTimeoutMs must be a positive number");
    if (occupiedRooms[appId]?.[roomId]) return occupiedRooms[appId][roomId];
    leavingRoomCleanups[appId]?.[roomId]?.(true);
    const rootTopicPlaintext = topicPath(libName, appId, roomId);
    const rootTopicP = sha1(rootTopicPlaintext);
    const selfTopicP = sha1(topicPath(rootTopicPlaintext, selfId));
    const key = genKey(config.password ?? "", appId, roomId);
    const roomNamespacePromise = deriveRoomNamespace(appId, roomId);
    const sharedPeerIdleMs = config._test_only_sharedPeerIdleMs ?? sharedPeerIdleMsDefault;
    let didLeaveRoom = false;
    const withKey = (f) => async (signal) => ({
      type: signal.type,
      sdp: await f(key, signal.sdp)
    });
    const toPlain = withKey(decrypt);
    const toCipher = withKey(encrypt);
    const makeOffer = () => peer_default(true, config);
    let reannounceOnDisconnect = false;
    const offerManager = new OfferManager(makeOffer);
    const encryptOffer = async (peer) => {
      const plainOffer = await peer.getOffer();
      if (!plainOffer || plainOffer.type !== "offer") throw mkErr("failed to get offer for peer");
      return (await toCipher(plainOffer)).sdp;
    };
    const connectPeer = (peer, peerId) => {
      membership.connect(peerId, peer, sharedPeerIdleMs);
    };
    let disconnectReannounceQueued = false;
    const reannounceAfterDisconnect = () => {
      if (isPassive || !reannounceOnDisconnect || disconnectReannounceQueued) return;
      disconnectReannounceQueued = true;
      queueMicrotask(() => {
        disconnectReannounceQueued = false;
        if (!didLeaveRoom) ctx.requeueAnnounce?.();
      });
    };
    const disconnectPeer = (peer, peerId) => {
      if (didLeaveRoom) return;
      const state = ctx.peerStates[peerId];
      if (state?.connectedPeer === peer) {
        clearConnectedPeer(state, peerId, "close-event");
        checkDeactivate();
        reannounceAfterDisconnect();
      }
    };
    const isPassive = Boolean(config.passive);
    let passiveActivationTimeout;
    let deactivateRelayAnnouncements = noOp;
    const checkDeactivate = () => {
      if (!isPassive || !ctx.isActive) return;
      let hasActiveWork = false;
      entries(ctx.peerStates).forEach(([peerId, state]) => {
        if (state.connectedPeer || state.answeringPeer || state.offerInitPromise || state.offerPeer || state.offerRelays.some(Boolean)) hasActiveWork = true;
        else delete ctx.peerStates[peerId];
      });
      if (!hasActiveWork) {
        ctx.isActive = false;
        passiveActivationTimeout = resetTimer(passiveActivationTimeout);
        announceTimeouts.forEach(resetTimer);
        announceTimeouts.length = 0;
        deactivateRelayAnnouncements();
        membership.setActive(false);
      }
    };
    const ctx = {
      appId,
      roomId,
      config,
      peerStates: {},
      rootTopicPlaintext,
      rootTopicP,
      selfTopicP,
      toPlain,
      toCipher,
      isLeaving: () => didLeaveRoom,
      isPassive,
      isActive: !isPassive,
      onJoinError,
      offerManager,
      encryptOffer,
      initPeer: peer_default,
      connectPeer,
      disconnectPeer,
      reusePeer: (peerId) => membership.reuse(peerId),
      checkDeactivate,
      announceIntervals: [],
      announceIntervalMs
    };
    const strategyContext = {
      config,
      appId,
      roomId,
      isPassive
    };
    const handleMessage = createSignalHandler(ctx);
    if (!didInit) {
      const initRes = init(config);
      initPromises = (Array.isArray(initRes) ? initRes : [initRes]).map((value) => Promise.resolve(value));
      didInit = true;
      cleanupWatchOnline = config.relayConfig?.manualReconnection ? noOp : watchOnline();
    }
    const announceScheduleIntervals = initPromises.map(() => announceIntervalMs);
    const announceAttemptCounts = initPromises.map(() => 0);
    const announceErrorStreaks = initPromises.map(() => 0);
    const announceTimeouts = [];
    const unsubFns = initPromises.map(async (relayP, i) => subscribe(await relayP, await rootTopicP, await selfTopicP, handleMessage(i), (n) => offerManager.getOffers(n, encryptOffer), strategyContext));
    all([rootTopicP, selfTopicP]).then(([rootTopic, selfTopic]) => {
      if (didLeaveRoom) return;
      const queueAnnounce = async (relay, i) => {
        if (didLeaveRoom) return;
        if (isPassive && !ctx.isActive) return;
        const extra = isPassive ? { passive: true } : void 0;
        let announceResult = void 0;
        try {
          announceResult = await announce(relay, rootTopic, selfTopic, extra, strategyContext);
          announceErrorStreaks[i] = 0;
        } catch (error) {
          if (didLeaveRoom) return;
          const errorStreak = announceErrorStreaks[i] ?? 0;
          if (errorStreak === 0 && config.relayConfig?.warnOnRelayFailure !== false) console.warn(`${libName}: announce failed - ${toErrorMessage(error, "")}`);
          announceErrorStreaks[i] = errorStreak + 1;
        }
        if (didLeaveRoom || isPassive && !ctx.isActive) return;
        if (announceResult && typeof announceResult !== "number" && "stopAnnouncing" in announceResult) return;
        if (typeof announceResult === "number") {
          ctx.announceIntervals[i] = announceResult;
          announceScheduleIntervals[i] = announceResult;
        } else if (announceResult) {
          announceScheduleIntervals[i] = announceResult.nextAnnounceMs;
          reannounceOnDisconnect ||= announceResult.reannounceOnDisconnect === true;
        }
        const announceAttempt = announceAttemptCounts[i] ?? 0;
        announceAttemptCounts[i] = announceAttempt + 1;
        const currentInterval = announceScheduleIntervals[i] ?? announceIntervalMs;
        const warmupDelay = announceWarmupIntervalsMs[announceAttempt] ?? (announceAttempt === 3 && typeof announceResult === "object" ? announceIntervalMs : void 0);
        announceTimeouts[i] = setTimeout(() => {
          queueAnnounce(relay, i);
        }, typeof warmupDelay === "number" ? Math.min(currentInterval, warmupDelay) : currentInterval);
      };
      deactivateRelayAnnouncements = () => {
        if (!deactivate) return;
        initPromises.forEach(async (relayP) => {
          const relay = await relayP;
          if (!didLeaveRoom) deactivate(relay, rootTopic, selfTopic, strategyContext);
        });
      };
      ctx.requeueAnnounce = () => {
        announceTimeouts.forEach(resetTimer);
        announceTimeouts.length = 0;
        passiveActivationTimeout = resetTimer(passiveActivationTimeout);
        membership.setActive(true);
        passiveActivationTimeout = setTimeout(checkDeactivate, passiveActivationGraceMs);
        initPromises.forEach(async (relayP, i) => {
          const relay = await relayP;
          if (relay && !didLeaveRoom) {
            announceAttemptCounts[i] = 0;
            queueAnnounce(relay, i);
          }
        });
      };
      unsubFns.forEach(async (didSub, i) => {
        await didSub;
        if (didLeaveRoom) return;
        const relay = await initPromises[i];
        if (relay && !didLeaveRoom && (!isPassive || ctx.isActive)) queueAnnounce(relay, i);
      });
    });
    let onPeerConnect = noOp;
    const sharedPassword = config.password ?? "";
    const { compose } = createPasswordHandshake(sharedPassword, appId, roomId);
    const composedPeerHandshake = compose(onPeerHandshake);
    const releaseOccupiedRoom = () => {
      if (occupiedRooms[appId]?.[roomId] === joinedRoom) {
        delete occupiedRooms[appId][roomId];
        if (keys(occupiedRooms[appId]).length === 0) delete occupiedRooms[appId];
      }
    };
    const clearLeavingCleanup = () => {
      if (leavingRoomCleanups[appId]?.[roomId] === cleanupRoom) {
        delete leavingRoomCleanups[appId][roomId];
        if (keys(leavingRoomCleanups[appId]).length === 0) delete leavingRoomCleanups[appId];
      }
    };
    const cleanupRoom = (rejoining = false) => {
      if (didLeaveRoom) return;
      didLeaveRoom = true;
      onPeerConnect = noOp;
      releaseOccupiedRoom();
      clearLeavingCleanup();
      membership.leave();
      entries(ctx.peerStates).forEach(([peerId, state]) => {
        if (state.connectedPeer && !state.connectedPeer.isDead) {
          if (!sharedPeers.owns(appId, peerId, state.connectedPeer)) state.connectedPeer.destroy();
        }
        if (state.answeringPeer && !state.answeringPeer.isDead) state.answeringPeer.destroy();
        resetOfferState(state);
        resetAnsweringState(state);
        state.connectedPeer = null;
        state.connectedPeerUnhealthySinceMs = null;
      });
      announceTimeouts.forEach(resetTimer);
      passiveActivationTimeout = resetTimer(passiveActivationTimeout);
      unsubFns.forEach(async (f) => {
        (await f)();
      });
      offerManager.destroy();
      if (rejoining || hasActiveRooms()) return;
      didInit = false;
      cleanupWatchOnline();
    };
    const roomOptions = {
      ...config.maxReceiveBytes === void 0 ? {} : { maxReceiveBytes: config.maxReceiveBytes },
      ...composedPeerHandshake ? { onPeerHandshake: composedPeerHandshake } : {},
      ...handshakeTimeoutMs === void 0 ? {} : { handshakeTimeoutMs },
      isPassive,
      onBeforeLeave: () => {
        releaseOccupiedRoom();
        (leavingRoomCleanups[appId] ??= {})[roomId] = cleanupRoom;
      },
      onHandshakeError: (peerId, error) => onJoinError?.({
        error: error.replace(/^handshake failed: /, ""),
        appId,
        peerId,
        roomId
      })
    };
    occupiedRooms[appId] ??= {};
    const joinedRoom = room_default((f) => onPeerConnect = f, (id) => {
      if (didLeaveRoom) return;
      const state = ctx.peerStates[id];
      if (state?.connectedPeer) detachConnectedPeer(state, state.connectedPeer);
      checkDeactivate();
      reannounceAfterDisconnect();
    }, () => cleanupRoom(false), roomOptions);
    const membership = sharedPeers.registerRoom(appId, roomId, roomNamespacePromise, {
      active: !isPassive || ctx.isActive,
      onPeer: (proxy, peerId, physical) => {
        const state = getState(ctx.peerStates, peerId);
        markPeerConnected(state, physical);
        if (isPassive && !ctx.isActive) {
          ctx.isActive = true;
          membership.setActive(true);
          if (ctx.requeueAnnounce) ctx.requeueAnnounce();
          else {
            passiveActivationTimeout = resetTimer(passiveActivationTimeout);
            passiveActivationTimeout = setTimeout(checkDeactivate, passiveActivationGraceMs);
          }
        }
        onPeerConnect(proxy, peerId);
        resetOfferState(state);
      },
      onDetach: (peerId, physical) => {
        detachConnectedPeer(ctx.peerStates[peerId], physical);
        checkDeactivate();
      }
    });
    return occupiedRooms[appId][roomId] = joinedRoom;
  };
};

// node_modules/@trystero-p2p/torrent/dist/index.mjs
var relayManager = createRelayManager((client) => client.socket);
var topicToInfoHash = {};
var infoHashToTopic = {};
var handledSignals = {};
var topicStates = relayManager.scoped();
var roomOutstandingOffers = {};
var roomOfferGenerationPromises = {};
var roomSubscriberCounts = {};
var trackerAction = "announce";
var hashLimit = 20;
var offersPerAnnounce = 1;
var requestedPeers = 3;
var defaultAnnounceMs = 1e4;
var dormantAnnounceMs = 12e4;
var offerRetentionMs = 12e4;
var signalDedupeWindowMs = 4e3;
var defaultRedundancy = 3;
var getInfoHash = async (topic) => {
  if (topicToInfoHash[topic]) return topicToInfoHash[topic];
  const hash = (await sha1(topic)).slice(0, hashLimit);
  topicToInfoHash[topic] = hash;
  infoHashToTopic[hash] = topic;
  return hash;
};
var send = async (client, topic, payload) => client.send(toJson({
  action: trackerAction,
  info_hash: await getInfoHash(topic),
  peer_id: selfId,
  ...payload
}));
var warn = (url, msg, didFail = false) => console.warn(`${libName}: torrent tracker ${didFail ? "failure" : "warning"} from ${url} - ${msg}`);
var getRoomOutstandingOffers = (rootTopic) => roomOutstandingOffers[rootTopic] ??= {};
var deleteRoomOfferBookkeeping = (rootTopic) => {
  delete roomOutstandingOffers[rootTopic];
  delete roomOfferGenerationPromises[rootTopic];
};
var takeOutstandingOffer = (rootTopic, offerId, action) => {
  const outstandingOffers = roomOutstandingOffers[rootTopic];
  const offer2 = outstandingOffers?.[offerId];
  if (!offer2) return;
  delete outstandingOffers[offerId];
  offer2[action]?.();
  if (!keys(outstandingOffers).length && !roomSubscriberCounts[rootTopic]) deleteRoomOfferBookkeeping(rootTopic);
  return offer2;
};
var reclaimAllOutstandingOffers = (rootTopic) => {
  keys(getRoomOutstandingOffers(rootTopic)).forEach((offerId) => takeOutstandingOffer(rootTopic, offerId, "reclaim"));
  deleteRoomOfferBookkeeping(rootTopic);
};
var pruneOutstandingOffers = (rootTopic) => {
  const now = Date.now();
  entries(getRoomOutstandingOffers(rootTopic)).forEach(([offerId, offer2]) => {
    if (now - offer2.createdAt > offerRetentionMs) takeOutstandingOffer(rootTopic, offerId, "reclaim");
  });
};
var ensureOutstandingOffers = async (rootTopic, getOffers) => {
  while (roomOfferGenerationPromises[rootTopic]) await roomOfferGenerationPromises[rootTopic];
  const nextPromise = (async () => {
    pruneOutstandingOffers(rootTopic);
    const outstandingOffers = getRoomOutstandingOffers(rootTopic);
    const outstandingCount = keys(outstandingOffers).length;
    const missingOffers = Math.max(0, offersPerAnnounce - outstandingCount);
    if (missingOffers > 0) (await getOffers(missingOffers)).forEach((peerAndOffer) => {
      outstandingOffers[genId(hashLimit)] = {
        ...peerAndOffer,
        createdAt: Date.now()
      };
    });
  })().finally(() => {
    if (roomOfferGenerationPromises[rootTopic] === nextPromise) delete roomOfferGenerationPromises[rootTopic];
  });
  roomOfferGenerationPromises[rootTopic] = nextPromise;
  await nextPromise;
  return getRoomOutstandingOffers(rootTopic);
};
var joinRoomStrategy = strategy_default({
  init: (config) => getRelays(config, defaultRelayUrls, defaultRedundancy).map((rawUrl) => {
    const client = relayManager.register(rawUrl, () => makeSocket(rawUrl, (rawData) => {
      const data = fromJson(rawData);
      const errMsg = data["failure reason"];
      const warnMsg = data["warning message"];
      const { interval } = data;
      const topic = data.info_hash ? infoHashToTopic[data.info_hash] : void 0;
      if (errMsg) {
        if (config.relayConfig?.warnOnRelayFailure !== false) warn(client.url, errMsg, true);
        return;
      }
      if (warnMsg && config.relayConfig?.warnOnRelayFailure !== false) warn(client.url, warnMsg);
      const state = topic ? topicStates.forKey(rawUrl)[topic] : void 0;
      if (interval && state) state.announceMs = Math.min(Math.max(interval * 1e3, defaultAnnounceMs), offerRetentionMs);
      if ((data.offer || data.answer) && topic && data.offer_id) {
        if (data.peer_id === selfId) return;
        const signalKey = `${topic}:${data.offer ? "offer" : "answer"}:${data.offer_id}:${data.peer_id ?? ""}`;
        const nowMs = Date.now();
        const lastHandledMs = handledSignals[signalKey];
        if (typeof lastHandledMs === "number" && nowMs - lastHandledMs < signalDedupeWindowMs) return;
        handledSignals[signalKey] = nowMs;
        entries(handledSignals).forEach(([key, handledAtMs]) => {
          if (nowMs - handledAtMs > signalDedupeWindowMs * 6) delete handledSignals[key];
        });
        state?.handler(data);
      }
    }, () => Object.values(topicStates.forKey(rawUrl)).forEach((state) => void state.announce())));
    return client.ready;
  }),
  subscribe: (client, rootTopic, _, onMessage, getOffers, context) => {
    const states = topicStates.forRelay(client);
    const subscriptionToken = Symbol(rootTopic);
    roomSubscriberCounts[rootTopic] = (roomSubscriberCounts[rootTopic] ?? 0) + 1;
    let passiveAnnounceTimeout;
    const stopPassiveAnnouncements = () => {
      clearTimeout(passiveAnnounceTimeout);
      passiveAnnounceTimeout = void 0;
    };
    const topicState = {
      announce: async () => {
        if (states[rootTopic]?.token !== subscriptionToken) return;
        if (!topicState.isActive) {
          send(client, rootTopic, {
            left: 0,
            numwant: requestedPeers,
            offers: []
          });
          return;
        }
        let outstandingOffers;
        try {
          outstandingOffers = await ensureOutstandingOffers(rootTopic, getOffers);
        } catch (error) {
          if (states[rootTopic]?.token !== subscriptionToken) return;
          throw error;
        }
        if (states[rootTopic]?.token !== subscriptionToken || !topicState.isActive) return;
        const offers = entries(outstandingOffers).map(([id, { offer: offer2 }]) => ({
          offer_id: id,
          offer: {
            type: "offer",
            sdp: offer2
          }
        }));
        send(client, rootTopic, {
          numwant: requestedPeers,
          offers
        });
      },
      announceMs: defaultAnnounceMs,
      handler: (data) => {
        if (data.offer && data.peer_id && data.offer_id) onMessage(rootTopic, {
          offer: data.offer.sdp,
          offerId: data.offer_id,
          peerId: data.peer_id
        }, (_2, signal) => void send(client, rootTopic, {
          answer: {
            type: "answer",
            sdp: fromJson(signal).answer
          },
          offer_id: data.offer_id,
          to_peer_id: data.peer_id
        }));
        else if (data.answer && data.offer_id && data.peer_id) {
          const offer2 = takeOutstandingOffer(rootTopic, data.offer_id, "claim");
          if (offer2) {
            onMessage(rootTopic, {
              answer: data.answer.sdp,
              offerId: data.offer_id,
              peerId: data.peer_id,
              peer: offer2.peer
            }, () => {
            });
            topicState.announce();
          }
        }
      },
      isActive: !context?.isPassive,
      startPassiveAnnouncements: () => {
        stopPassiveAnnouncements();
        if (states[rootTopic]?.token !== subscriptionToken || topicState.isActive) return;
        topicState.announce();
        passiveAnnounceTimeout = setTimeout(topicState.startPassiveAnnouncements, Math.max(topicState.announceMs, dormantAnnounceMs));
      },
      stopPassiveAnnouncements,
      token: subscriptionToken
    };
    states[rootTopic] = topicState;
    if (!topicState.isActive) topicState.startPassiveAnnouncements();
    return () => {
      topicState.stopPassiveAnnouncements();
      roomSubscriberCounts[rootTopic] = Math.max(0, (roomSubscriberCounts[rootTopic] ?? 1) - 1);
      if (!roomSubscriberCounts[rootTopic]) {
        delete roomSubscriberCounts[rootTopic];
        reclaimAllOutstandingOffers(rootTopic);
      }
      if (states[rootTopic]?.token === subscriptionToken) delete states[rootTopic];
    };
  },
  announce: async (client, rootTopic) => {
    const state = topicStates.forRelay(client)[rootTopic];
    if (state) {
      state.stopPassiveAnnouncements();
      state.isActive = true;
      await state.announce();
    }
    return state?.announceMs ?? defaultAnnounceMs;
  },
  deactivate: (client, rootTopic) => {
    const state = topicStates.forRelay(client)[rootTopic];
    if (state) state.isActive = false;
    reclaimAllOutstandingOffers(rootTopic);
    state?.startPassiveAnnouncements();
  }
});
var joinRoom = (config, roomId, callbacks) => joinRoomStrategy({
  ...config,
  trickleIce: config.trickleIce ?? false
}, roomId, callbacks);
var getRelaySockets = relayManager.getSockets;
var defaultRelayUrls = [
  "open.ftorrent.com",
  "tracker.webtorrent.dev",
  "tracker.openwebtorrent.com",
  "tracker.btorrent.xyz",
  "tracker.files.fm:7073/announce"
].map((url) => "wss://" + url);
export {
  defaultRelayUrls,
  getRelaySockets,
  joinRoom,
  pauseRelayReconnection,
  resumeRelayReconnection,
  selfId
};

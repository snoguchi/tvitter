Hash = function(o) { this.extend(o) };
Hash.prototype = {
  forEach: function(f, o) {
    o = o || this;
    for (var k in this)
      if (this.hasOwnProperty(k))
	f.call(o, k, this[k], this);
  },
  map: function(f, o) {
    var r = [];
    this.forEach(function() { r.push(f.apply(o, arguments)); });
    return r;
  },
  reduce: function(r, f, o) {
    this.forEach(function() {
      Array.unshift(arguments, r); r = f.apply(o, arguments); });
    return r;
  },
  filter: function(f, o) {
    var r = {};
    for (var k in this)
      if (f.apply(o, arguments))
	r[k] = v;
    return r;
  },
  extend: function(o) {
    for (var k in o)
      this[k] = o[k];
    return this;
  }
};

Function.prototype.__proto__ = {
  bind: function(o) {
    var f = this;
    return function() { return f.apply(o, arguments); };
  },
  bless: (function(g) {
    var seq = 0;
    return function(o) {
      var self = this, name = '__bLs' + seq++;
      var f = eval('(g[name] = function ' + name
        + '() {return self.apply(o, arguments)})');
      f.curse = function() { delete g[name]; };
      return f;
    };
  })(this),
  __noSuchMethod__: function(name, args) {
    return this.prototype[name].apply(args.shift(), args);
  }
};

Array.prototype.__proto__ = {
  __proto__: Hash.prototype,
  invoke: function(name, args) {
    args = args || [];
    return this.map(function(v) { return v[name].apply(v, args); });
  },
  indexOf: function(item) {
    for (var i = 0, n = this.length; i < n; i++)
      if (this[i] === item)
        return i;
    return -1;
  },
  remove: function(item) {
    for (var i = 0, n = this.length; i < n; i++)
      if (this[i] === item)
        this.splice(i, 1);
  },
  get last() {
    return this[this.length - 1];
  }
};

String.prototype.__proto__ = {
  __proto__: Hash.prototype,
  bind: function(o) {
    var f = o[this];
    return function() { return f.apply(o, arguments); };
  },
  fill: function(o) {
    return this.replace(/\#\{(.*?)\}/g, function(_, name) { return o[name]; });
  },
  thaw: function() {
    try { return eval('(' + this + ')'); } catch(e) { print(e.message); }
  },
  get chars() {
    return this.match(/([\x00-\x7f]|[\xc2-\xfd][\x80-\xbf]+)/g);
  }
};

Number.prototype.__proto__ = {
  __proto__: Hash.prototype,
  forEach: function(f, o) {
    Array(this + 1).join().split('').forEach(function(_, i) {
      f.call(o, i, this);
    }, this);
  }
};

XMLDOM.prototype.__proto__ = {
  __proto__: Hash.prototype,
  elem: XMLDOM.prototype.getElementsByTagName,
  attr: XMLDOM.prototype.getAttribute,
  text: function(name) {
    return this.elem(name).join('');
  },
  toString: function() {
    return this.nodeName.charAt(0) == '#'
      ? this.nodeValue : this.childNodes.join('');
  }
};

Observable = function() { this._observers = []; };
Observable.prototype = {
  __proto__: Hash.prototype,
  observe: function(o, caller) {
    var caller = caller || o;
    var list = this._observers;
    var func = typeof o == 'function' ? o.bind(caller)
      : function(type, args) { if (o[type]) o[type].apply(caller, args); };
    list.push(func);
    return function() { list.remove(func); };
  },
  signal: function(type, args) {
    this._observers.forEach(function(f) { f(type, args); });
  }
};

System = {
  event: new Observable,
  input: new Observable
};
'onLoad onFocus onUnfocus onActivate'.split(' ').forEach(function(s) {
  this[s] = function() { System.event.signal(s); };
}, this);
'onConfirmKey onUpKey onDownKey onLeftKey onRightKey onBlueKey onRedKey onGreenKey onYellowKey'.split(' ').forEach(function(s) {
  this[s] = function(type) {
    System.input.signal(s + (type ? 'Released' : 'Pressed'));
    System.input.signal(s, type);
  };
}, this);

Timer = function(reso) {
  this._proxy = this._fire.bless(this);
  this._list = [];
  this._reso = reso || 1000;
};
Timer.prototype = {
  _fire: function() {
    var now = Date.now();
    this._list.sort(function(a, b) { return a.expire - b.expire; });
    while (this._list.length && this._list[0].expire <= now) {
      var id = this._list.shift();
      id.callback();
      if (id.interval) {
        id.expire = now + id.interval;
        this._list.push(id);
      }
    }
    delete this._tid;
    if (this._list.length) {
      this._list.sort(function(a, b) { return a.expire - b.expire; });
      this._schedule(this._list[0].expire);
    }
  },
  _schedule: function(expire) {
    if (this._tid) {
      if (expire >= this._expire)
        return;
      clearTimeout(this._tid);
    }
    var now = Date.now();
    var period = Math.max(1, expire - now);
    period = Math.ceil(period / this._reso) * this._reso;
    this._tid = setTimeout(this._proxy, period);
    this._expire = now + period;
  },
  _add: function(timeout, interval, f, o) {
    var now = Date.now(), exp = now + timeout, self = this;
    var id = {callback:f.bind(o), expire:exp, interval:interval};
    this._list.push(id);
    this._schedule(exp);
    return function() {
      self._list.remove(id);
      delete id.interval; // avoid pendding
    };
  },
  timeout: function(t, f, o) { return this._add(t, 0, f, o); },
  interval: function(t, f, o) { return this._add(t, t, f, o); }
};

System.timer = new Timer;

HTTP = function() {
  Observable.call(this);
  this.xhr = new XMLHttpRequest();
  this.xhr._owner = this;
  this.xhr.onreadystatechange = function() {
    if (this.readyState == 4)
      this._owner._complete();
  };
};
HTTP.prototype = {
  __proto__: Observable.prototype,
  _sentq: [],
  _waitq: [],
  _max: 3,
  _pump: function() {
    while (this._sentq.length < this._max && this._waitq.length > 0) {
      var req = this._waitq.shift();
      this._sentq.push(req);
      req._send();
    }
  },
  _remove: function() {
    this._waitq.remove(this);
    this._sentq.remove(this);
    this.xhr.onreadystatechange = function() {};
  },
  _complete: function() {
    this._remove();
    this.signal(this.success ? 'onSuccess' : 'onFailure', [this.xhr]);
    this.signal('onComplete', [this.xhr]);
    this._pump();
  },
  get success() {
    return this.xhr.status >= 200 && this.xhr.status < 300;
  },
  abort: function() {
    this.xhr.abort();
    this._remove();
    this._pump();
  },
  send: function(body) {
    var xhr = this.xhr;
    this._send = function() { xhr.send(body); };
    this._waitq.push(this);
    this._pump();
  },
  __noSuchMethod__: function(name, args) {
    return this.xhr[name].apply(this.xhr, args);
  }
};

HTTP.get = function(url) {
  var req = new HTTP;
  req.open('GET', url, true);
  req.send(null);
  return req;
};

Node = function(node) {
  Observable.call(this);
  this._node = node;
};
Node.prototype = {
  __proto__: Observable.prototype,
  _call: function(f, args) {
    var ary = [this._node];
    ary.push.apply(ary, args);
    return f.apply(null, ary);
  },
  _set: function(f, k, v) {
    if (this._node[k] != v) f(this._node, (this._node[k] = v)); return v;
  },
  _get: function(f, k) {
    return k in this._node ? this._node[k] : (this._node[k] = f(this._node));
  },
  setStr: function(v) {
    delete this._node.lines;
    this._set(setStr, 'str', v.toString());
  },
  setVisible: function(v) {
    this._set(setVisible, 'visible', v ? 1 : 0);
  },
  loadImage: function() {
    delete this._node.w;
    delete this._node.h;
    this._call(loadImage, arguments);
  },
  child: function(name, klass) {
    var n = new (klass || Node)(getChildNode(this._node, name));
    n.parentNode = this;
    return n;
  },
  set str(v) {
    return this.setStr(v);
  },
  set visible(v) {
    return this.setVisible(v);
  },
  set image(v) {
    return this.loadImage(v);
  },
  show: function() {
    this.setVisible(1);
  },
  hide: function() {
    this.setVisible(0);
  },
  notify: function(type, args) {
    if (this[type])
      this[type].apply(this, args);
    else if (this.parentNode)
      this.parentNode.notify(type, args);
  },
  focus: function() {
    Node.focusNode.onInputBlur();
    Node.focusNode = this;
    this.onInputFocus();
  },
  onInputFocus: function() {},
  onInputBlur: function() {}
};

Hash.forEach({ x:getPosX, y:getPosY, w:getW, h:getH, str:getStr, visible:isVisible, rgb:getRGB, alpha:getAlpha, scaleX:getScaleX, scaleY:getScaleY, name:getName, lines:getLines }, function(k, f) {
  Node.prototype[f.name] = function() { return this._get(f, k); };
  Node.prototype.__defineGetter__(k, function() { return this[f.name](); });
});

Hash.forEach({ x:setPosX, y:setPosY, w:setW, h:setH, /* str:setStr, visible:setVisible, */ rgb:setRGB, alpha:setAlpha, scaleX:setScaleX, scaleY:setScaleY }, function(k, f) {
  Node.prototype[f.name] = function(v) { return this._set(f, k, v); };
  Node.prototype.__defineSetter__(k, function(v) { return this[f.name](v); });
});

[isImageLoaded, destroyImage, pageDown, pageUp, lineDown, lineUp].forEach(function(f) {
  Node.prototype[f.name] = function() { return this._call(f, arguments); };
});

Node.focusNode = new Node(getRootNode());

System.input.observe(function(type, args) {
  Node.focusNode.notify(type, args);
});

ListBox = function() {
  Node.apply(this, arguments);
  this.frameNode = this;
  this.itemNodes = [];
  this.itemData = [];
};
ListBox.prototype = {
  __proto__: Node.prototype,
  base: 0,
  offset: 0,
  get selectedIndex() {
    return this.base + this.offset;
  },
  get selectedData() {
    return this.itemData[this.selectedIndex];
  },
  get selectedNode() {
    return this.itemNodes[this.selectedIndex % this.itemNodes.length];
  },
  get hasNext() {
    return this.selectedIndex < this.itemData.length - 1;
  },
  get hasPrev() {
    return this.selectedIndex > 0;
  },
  update: function(param) {
    this.extend(param || {});
    var top = 0;
    this.frameNode.hide();
    this.itemNodes.forEach(function(node, i) {
      var data = this.itemData[this.base + i];
      if (data) {
	this.onDrawItem(node, data);
	node.y = top + node.h / 2;
	top += node.h;
	node.show();
      } else {
	node.hide();
      }
    }, this);
    this.frameNode.y = - this.frameNode.h / 2;
    this._adjust();
    this.frameNode.show();
    this.onSelectItem(this.selectedNode, this.selectedData);
  },
  _adjust: function() {
    var fn = this.frameNode, sn = this.selectedNode;
    if (fn.y + sn.y - sn.h / 2 < - fn.h / 2) // top
      fn.y = - sn.y - (fn.h - sn.h) / 2;
    else if (fn.y + sn.y + sn.h / 2 > fn.h / 2) // bottom
      fn.y = - sn.y + (fn.h - sn.h) / 2;
  },
  next: function() {
    if (this.hasNext) {
      if (this.offset < this.itemNodes.length - 1) {
	this.offset++;
      } else {
	var node = this.selectedNode;
	this.base++;
	this.onDrawItem(this.selectedNode, this.selectedData);
	this.selectedNode.y = node.y + (node.h + this.selectedNode.h) / 2;
      }
      this._adjust();
      this.onSelectItem(this.selectedNode, this.selectedData);
    }
  },
  prev: function() {
    if (this.hasPrev) {
      if (this.offset > 0) {
	this.offset--;
      } else {
	var node = this.selectedNode;
	this.base--;
	this.onDrawItem(this.selectedNode, this.selectedData);
	this.selectedNode.y = node.y - (node.h + this.selectedNode.h) / 2;
      }
      this._adjust();
      this.onSelectItem(this.selectedNode, this.selectedData);
    }
  },
  onDrawItem: function() {},
  onSelectItem: function() {}
};

Slider = function() { Node.apply(this, arguments); };
Slider.prototype = {
  __proto__: Node.prototype,
  size: 1,
  direction: 'horizontal',
  _traits: {horizontal:{pos:'x', size:'w'}, vertical:{pos:'y', size:'h'}},
  update: function(param) { // size, count, pos
    this.extend(param || {});
    this.size = Math.min(this.size, this.count);
    this.pos = Math.min(this.pos, this.count - this.size);
    var t = this._traits[this.direction];
    var sz1 = this[t.size];
    var sz2 = this.count ? sz1 * this.size / this.count : sz1;
    var step = this.count - this.size;
    var pos = step ? (sz1 - sz2) * (this.pos / step - 0.5) : 0;
    this.thumbNode[t.size] = sz2;
    this.thumbNode[t.pos] = pos;
  }
};


Date.prototype.format = (function() {
  var handler = {
    Y: function(d) { return d.getFullYear().toString(); },
    y: function(d) { return d.getFullYear().toString().slce(-2); },
    m: function(d) { return ('0' + (d.getMonth() + 1)).slice(-2); },
    d: function(d) { return ('0' + d.getDate()).slice(-2); },
    H: function(d) { return ('0' + d.getHours()).slice(-2); },
    M: function(d) { return ('0' + d.getMinutes()).slice(-2); },
    S: function(d) { return ('0' + d.getSeconds()).slice(-2); }
  };
  return function(str) {
    var d = this;
    return str.replace(/%([a-zA-Z%])/g, function(_, c) {
      return handler[c](d);
    });
  };
})();

Iterator = function(ary) {
  this.ary = ary;
  this.index = 0;
}
Iterator.prototype = {
  get current() { return this.ary[this.index] },
  get hasNext() { return this.index < this.ary.length - 1 },
  get hasPrev() { return this.index > 0 },
  next: function() {
    this.index = (this.index + 1) % this.ary.length;
    return this.ary[this.index];
  },
  prev: function() {
    this.index = (this.index + this.ary.length - 1) % this.ary.length;
    return this.ary[this.index]
  }
}

Crypt = {};

Crypt.Util = {
  bytesToHexString: function(bytes) {
    return bytes.map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  },
  bytesToBase64: function(bytes) {
    var base64map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var base64 = [];
    bytes.forEach(function(b, i) {
      if (i % 3 !== 0)
	return;
      var triplet = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      var remain = bytes.length - i;
      base64.push(base64map.charAt((triplet >>> 18) & 0x3F));
      base64.push(base64map.charAt((triplet >>> 12) & 0x3F));
      base64.push(remain > 1 ? base64map.charAt((triplet >>> 6) & 0x3F) : '=');
      base64.push(remain > 2 ? base64map.charAt(triplet & 0x3F) : '=');
    });
    return base64.join('');
  },
  bytesToWords: function(bytes) {
    var words = [];
    bytes.forEach(function(byte, i) {
      var b = i * 8;
      words[b >>> 5] |= byte << (24 - b % 32);
    });
    return words;
  },
  wordsToBytes: function(words) {
    var bytes = [];
    words.forEach(function(word, i) {
      var b = i * 32;
      bytes.push((words[b        >>> 5] >>> 24) & 0xFF);
      bytes.push((words[(b +  8) >>> 5] >>> 16) & 0xFF);
      bytes.push((words[(b + 16) >>> 5] >>>  8) & 0xFF);
      bytes.push((words[(b + 24) >>> 5])        & 0xFF);
    });
    return bytes;
  },
  stringToBytes: function(str) {
    return str.split('').map(function(c) { return c.charCodeAt(0); });
  },
  stringToWords: function(str) {
    var words = [];
    str.split('').forEach(function(c, i) {
      var b = i * 8;
      words[b >>> 5] |= c.charCodeAt(0) << (24 - b % 32);
    });
    return words;
  },
  encodeURI: function(str) {
    return escape(str).replace(/%7E/g, "~").replace(/[@+*\/]/g, function(c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  },
  queryStringToHash: function(str) {
    return str.split("&").reduce({}, function(o, token) {
      var pair = token.split("=", 2);
      o[pair[0]] = pair[1];
      return o;
    });
  },
  hashToQueryString: function(obj) {
    var r = [];
    for (var k in obj)
      r.push(k + '=' + escape(obj[k]));
    return r.join('&');
  }
};

Crypt.SHA1 = function(message) {
  var l = message.length * 8,
  m = typeof message === 'string' ? Crypt.Util.stringToWords(message) : Crypt.Util.bytesToWords(message),
  w  =  [],
  H0 =  1732584193,
  H1 = -271733879,
  H2 = -1732584194,
  H3 =  271733878,
  H4 = -1009589776;

  m[l >> 5] |= 0x80 << (24 - l % 32);
  m[((l + 64 >>> 9) << 4) + 15] = l;

  for (var i = 0; i < m.length; i += 16) {

    var a = H0,
    b = H1,
    c = H2,
    d = H3,
    e = H4;

    (80).forEach(function(j) {
      if (j < 16)
	w[j] = m[i + j];
      else {
	var n = w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16];
	w[j] = (n << 1) | (n >>> 31);
      }

      var t = ((H0 << 5) | (H0 >>> 27)) + H4 + (w[j] >>> 0) + (
	j < 20 ? (H1 & H2 | ~H1 & H3) + 1518500249 :
	  j < 40 ? (H1 ^ H2 ^ H3) + 1859775393 :
	  j < 60 ? (H1 & H2 | H1 & H3 | H2 & H3) - 1894007588 :
	  (H1 ^ H2 ^ H3) - 899497514);

      H4 =  H3;
      H3 =  H2;
      H2 = (H1 << 30) | (H1 >>> 2);
      H1 =  H0;
      H0 =  t;
    });

    H0 += a;
    H1 += b;
    H2 += c;
    H3 += d;
    H4 += e;
  }

  return Crypt.Util.wordsToBytes([H0, H1, H2, H3, H4]);
}
Crypt.SHA1._blocksize = 16;


Crypt.HMAC = function(hasher, key, message) {
  if (typeof key === 'string')
    key = Crypt.Util.stringToBytes(key);
  if (key.length > hasher._blocksize * 4)
    key = hasher(key);
  var okey = key.slice(0), ikey = key.slice(0);
  for (var i = 0, n = hasher._blocksize * 4; i < n; i++) {
    okey[i] ^= 0x5C;
    ikey[i] ^= 0x36;
  }
  var f = function(message) {
    var m = Crypt.Util.stringToBytes(message);
    return hasher(okey.concat(hasher(ikey.concat(m))));
  }
  return typeof message === 'undefined' ? f : f(message);
}


OAuth = function(param) {
  this.param = param;
  var key = param.oauth_consumer_secret + '&' + (param.oauth_token_secret || '');
  this.hmac = Crypt.HMAC(Crypt.SHA1, key);
}
OAuth.prototype = {
  nonce: (function() {
    var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz';
    return function(len) {
      return Array(len + 1).join().split('').map(function() {
	return chars.charAt(Math.floor(Math.random() * chars.length));
      }).join('');
    }
  })(),
  request: function(method, url, param) {
    var auth = {
      oauth_nonce: this.nonce(6),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: parseInt(Date.now() / 1000),
      oauth_version: '1.0',
    };

    if (this.param.oauth_consumer_key)
      auth.oauth_consumer_key = this.param.oauth_consumer_key;

    if (this.param.oauth_token)
      auth.oauth_token = this.param.oauth_token;

    var sign = [], header = [], query = [];
    for (var k in auth) {
      sign.push(k + '=' + auth[k]);
      header.push(k + '="' + Crypt.Util.encodeURI(auth[k]) + '"');
    }

    for (var k in param || {}) {
      var pair = k + '=' + Crypt.Util.encodeURI(param[k]);
      sign.push(pair);
      query.push(pair);
    }

    var seed = [
      method,
      Crypt.Util.encodeURI(url),
      Crypt.Util.encodeURI(sign.sort().join('&'))
    ].join('&');
    header.push('oauth_signature="' + Crypt.Util.encodeURI(Crypt.Util.bytesToBase64(this.hmac(seed))) + '"');

    var req = new HTTP;
    if (method === 'GET') {
      if (query.length)
	url += '?' + query.join('&');
      req.open('GET', url, true);
      req.setRequestHeader('Authorization', 'OAuth ' + header.sort().join(', '));
      req.send(null);
    } else if (method === 'POST') {
      req.open('POST', url, true);
      req.setRequestHeader('Authorization', 'OAuth ' + header.sort().join(', '));
      req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      req.send(query.join('&'));
    }
    return req;
  }
};

//////////////////////////////////////////////////////////////////////////////
Twitter = function(param) {
  this.param = param;
}
Twitter.prototype = {
  login: function(username, password) {
    var xauth = new OAuth({
      oauth_consumer_key: this.param.oauth_consumer_key,
      oauth_consumer_secret: this.param.oauth_consumer_secret
    });
    var req = xauth.request('POST', 'https://api.twitter.com/oauth/access_token', {
      x_auth_mode: 'client_auth',
      x_auth_username: username,
      x_auth_password: password
    });
    req.observe({
      onSuccess: function(xhr) {
	var res = Crypt.Util.queryStringToHash(xhr.responseText);
	this.oauth = new OAuth({
	  oauth_consumer_key: this.param.oauth_consumer_key,
	  oauth_consumer_secret: this.param.oauth_consumer_secret,
	  oauth_token: res.oauth_token,
	  oauth_token_secret: res.oauth_token_secret
	});
      },
      onFailure: function(xhr) {
	print('login failed');
	print(xhr.responseText);
      }
    }, this);
    return req;
  },
  _get: function(path, param) {
    var req = new HTTP;
    if (param)
      path += '?' + Crypt.Util.hashToQueryString(param);
    req.open('GET', 'http://api.twitter.com/1' + path);
    req.send(null);
    return req;
  },
  post: function(path, param) {
    return this.oauth.request('POST', 'http://api.twitter.com/1' + path, param);
  },
  get: function(path, param) {
    return this.oauth.request('GET', 'http://api.twitter.com/1' + path, param);
  }
};

Twitter.Status = function(s) {
  var u = s.elem('user')[0] || s.elem('sender')[0];
  return {
    text: s.text('text'),
    created_at: s.elem('created_at')[0].toString(),
    favorites: s.text('favorited'),
    user: {
      screen_name: u.text('screen_name'),
      profile_image_url: u.text('profile_image_url')
    }
  };
}

/////////////////////////////////////////////////////////////////////////////
App = {}

App.dic = {
  menu: {
    home:      'ホーム',
    replies:   'あなた宛のつぶやき',
    messages:  'ダイレクトメッセージ',
    favorites: 'お気に入り',
    everyone:  '公開つぶやき'
  },
  error: {
    401: '認証に失敗しました (401)',
    net: '通信エラーが発生しました',
    setting: 'アプリ設定をして下さい'
  },
  request: {
    loading: '読み込み中 ...',
    updating: '投稿中 ...'
  }
}

App.Scrollbar = function() {
  Slider.apply(this, arguments);
  this.thumbNode = this.child('thumb');
  this.thumbNode.extend({
    bg: this.thumbNode.child('bg'),
    fg: this.thumbNode.child('fg'),
    setH: function(h) { this.bg.h = this.fg.h = h }
  });
}
App.Scrollbar.prototype = {
  __proto__: Slider.prototype,
  direction: 'vertical',
  update: function(listbox) {
    if (listbox.itemData.length < listbox.itemNodes.length) {
      this.thumbNode.hide();
    } else {
      Slider.update(this, {
	count: listbox.itemData.length,
	size:  listbox.itemNodes.length,
	pos:   listbox.base
      });
      this.thumbNode.show();
    }
  }
}

App.Menu = function() {
  Node.apply(this, arguments);
  this.itemNodes = new Iterator('home replies messages favorites everyone'.split(' ').map(function(name) {
    var icon = this.child(name);
    icon.image = 'img/' + name + '.png';
    return icon;
  }, this));
  this.labelNode = this.child('label');
  this.selectorNode = this.child('selector');
  this.refresh();
}
App.Menu.prototype = {
  __proto__: Node.prototype,
  get id() {
    return this.itemNodes.current.name;
  },
  set id(v) {
    var ary = this.itemNodes.ary;
    for (var i = 0; i < ary.length; i++) {
      if (ary[i].name == v) {
	this.itemNodes.index = i;
	this.refresh();
	break;
      }
    }
  },
  refresh: function() {
    this.selectorNode.x = this.itemNodes.current.x;
    this.labelNode.str = App.dic.menu[this.id];
  },
  onRightKeyPressed: function() {
    this.itemNodes.next();
    this.refresh();
    this.notify('onMenuChanged', [this.id]);
  },
  onLeftKeyPressed: function() {
    this.itemNodes.prev();
    this.refresh();
    this.notify('onMenuChanged', [this.id]);
  }
}

App.List = function() {
  ListBox.apply(this, arguments);
  this.frameNode = this.child('frame');
  this.selectorNode = this.child('selector');
  this.scrollbar = this.child('scrollbar', App.Scrollbar);
}
App.List.prototype = {
  __proto__: ListBox.prototype,
  onSelectItem: function() {
    if (this.selectedNode) {
      this.selectorNode.h = this.selectedNode.h;
      this.selectorNode.y = this.selectedNode.y;
      this.scrollbar.update(this);
    }
  },
  onInputFocus: function() {
    this.selectorNode.show();
    this.scrollbar.show();
  },
  onInputBlur: function() {
    this.selectorNode.hide();
    this.scrollbar.hide();
  }
}

App.InputForm = function() {
  Node.apply(this, arguments);
  this.selectorNode = this.child('selector');
}
App.InputForm.prototype = {
  __proto__: Node.prototype,
  onInputFocus: function() {
    this.selectorNode.show();
  },
  onInputBlur: function() {
    this.selectorNode.hide();
  }
}

App.NormalView = function() {
  Node.apply(this, arguments);
  this.menu = this.child('menu', App.Menu);
  this.list = this.child('item', App.List);
  this.list.itemNodes = (5).map(function(i) {
    var node = this.child('item' + i);
    node.icon = node.child('icon');
    node.user = node.child('user');
    node.text = node.child('text');
    return node;
  }, this.list);
  this.list.onDrawItem = this.onDrawItem.bind(this);
  this.child('logo').loadImage('img/logo.png');
}
App.NormalView.prototype = {
  __proto__: Node.prototype,
  update: function(data) {
    this.list.update({itemData:data[this.menu.id] || [], base:0, offset:0});
  },
  onDrawItem: function(node, data) {
    if (node && data) {
      var user = data.user || data.sender;
      node.text.str = data.text;
      node.user.str = user.screen_name;
      if (node.icon.url != user.profile_image_url) {
	node.icon.destroyImage();
	node.icon.image = node.icon.url = user.profile_image_url;
      }
    }
  },
  onInputFocus: function() {
    this.list.onInputFocus();
  },
  onInputBlur: function() {
    this.list.onInputBlur();
  },
  onLeftKeyPressed: function() {
    this.menu.onLeftKeyPressed();
  },
  onRightKeyPressed: function() {
    this.menu.onRightKeyPressed();
  },
  onUpKeyPressed: function() {
    if (this.list.hasPrev)
      this.list.prev();
  },
  onDownKeyPressed: function() {
    if (this.list.hasNext)
      this.list.next();
  }
}

App.ActiveView = function() {
  Node.apply(this, arguments);
  this.menu = this.child('menu', App.Menu);
  this.list = this.child('item', App.List);
  this.list.itemNodes = (7).map(function(i) {
    var node = this.child('item' + i);
    node.offset = node.child('offset');
    node.bg   = node.child('bg');
    node.icon = node.child('icon');
    node.user = node.child('user');
    node.date = node.child('date');
    node.text = node.child('text');
    node.text.lineHeight = 16;
    node.star = node.child('star');
    node.star.image = 'img/favorites.png';
    return node;
  }, this.list);
  this.list.onDrawItem = this.onDrawItem.bind(this);
  this.inputForm = this.child('input', App.InputForm);
  this.child('logo').loadImage('img/logo.png');
  this.kids = new Iterator([this.inputForm, this.list]);
  this.kids.next();
}
App.ActiveView.prototype = {
  __proto__: Node.prototype,
  update: function(data) {
    this.list.update({itemData:data[this.menu.id] || [], base:0, offset:0});
  },
  onDrawItem: function(node, data) {
    if (node && data) {
      var user = data.user || data.sender;
      if (node.icon.url != user.profile_image_url) {
	node.icon.destroyImage();
	node.icon.image = node.icon.url = user.profile_image_url;
      }
      node.user.str = user.screen_name;
      node.date.str = (new Date(data.created_at)).format('%m/%d %H:%M');
      node.text.str = data.text;
      node.text.h = node.text.lines * node.text.lineHeight;
      node.star.visible = data.favorited;
      node.h = Math.max(node.text.h + 26, 60);
      node.bg.h = node.h + 1;
      node.offset.y = (node.h / -2) + 30;
    }
  },
  onInputFocus: function() {
    this.kids.current.onInputFocus();
  },
  onLeftKeyPressed: function() {
    this.menu.onLeftKeyPressed();
  },
  onRightKeyPressed: function() {
    this.menu.onRightKeyPressed();
  },
  onUpKeyPressed: function() {
    if (this.kids.current.hasPrev)
      this.kids.current.prev();
    else if (this.kids.hasPrev) {
      this.kids.current.onInputBlur();
      this.kids.prev();
      this.kids.current.onInputFocus();
    }
  },
  onDownKeyPressed: function() {
    if (this.kids.current.hasNext)
      this.kids.current.next();
    else if (this.kids.hasNext) {
      this.kids.current.onInputBlur();
      this.kids.next();
      this.kids.current.onInputFocus();
    }
  },
  onConfirmKeyPressed: function() {
    var data = this.list.selectedData;
    var text = this.kids.current === this.inputForm ? prompt('', '', false)
      : data.sender ? prompt('', 'd ' + data.sender.screen_name + ' ', false)
      : data.user   ? prompt('', '@' + data.user.screen_name + ' ', false)
      : null;
    if (text)
      this.notify('onStatusUpdate', [text]);
  }
}

App.Message = function() {
  Node.apply(this, arguments);
  this.textNode = this.child('text');
}
App.Message.prototype = {
  __proto__: Node.prototype,
  set text(msg) {
    this.textNode.str = msg;
    this.show();
  }
}

App.Controller = function() {
  Node.call(this, getRootNode());
  System.event.observe(this);
  this.msg = this.child('msg', App.Message);
}
App.Controller.prototype = {
  __proto__: Node.prototype,
  get hasAccountSetting() {
    return this.account.username && this.account.password;
  },
  startRefresh: function() {
    this.stopRefresh = System.timer.interval(5 * 60 * 1000, function() {
      this.cache = {};
      this.onMenuChanged(this.view.menu.id);
    }, this);
  },
  onLoad: function() {
    this.account = {
      username: getStoredValue('Item2'),
      password: getStoredValue('Item1')
    }

    this.cache = {};
    this.error = {};
    this.request = {};

    this.view = this.child('normal', App.NormalView);

    this.twitter = new Twitter({
      oauth_consumer_key: "QyYZAhRX11iWd9qBUEGA",
      oauth_consumer_secret: "Y6fncKFfqNTpUvzlWKK73fFCwk7HI4wemo9w43kRR4"
    });
    if (this.hasAccountSetting) {
      this.twitter.login(this.account.username, this.account.password).observe({
	onSuccess: function(xhr) {
	  this.view.menu.id = 'home';
	  this.onMenuChanged(this.view.menu.id);
	  this.startRefresh();
	}
      }, this);
    } else {
      this.view.menu.id = 'everyone';
      this.onMenuChanged(this.view.menu.id);
      this.startRefresh();
    }
  },
  onFocus: function() {
    this.view.focus();
    this.stopRefresh();
    delete this.stopRefresh;
  },
  onUnfocus: function() {
    this.focus();
    this.startRefresh();
  },
  onActivate: function() {
    var nv = this.view;
    this.view = this.child('active', App.ActiveView);
    this.view.menu.id = nv.menu.id;
    this.view.show();
    if (this.cache[this.view.menu.id])
      this.view.update(this.cache);
    this.view.focus();
  },
  onStatusUpdate: function(str) {
    var id = this.view.menu.id;
    this.request[id] = 'updating';
    this.msg.text = App.dic.request.updating;
    this.twitter.post('/statuses/update.xml', {
      status: str,
      source: 'tvitter'
    }).observe({
      onSuccess: function(xhr) {
	this.error[id] = undefined;
	this.cache.home.unshift(Twitter.Status(xhr.responseXML));
	this.view.update(this.cache);
	this.msg.hide();
      },
      onFailure: function(xhr) {
	this.error[id] = xhr.status;
	this.msg.text = (App.dic.error[xhr.status] || App.dic.error.net).fill(xhr);
      },
      onComplete: function(xhr) {
	this.request[id] = undefined;
	this.msg.hide();
      }
    }, this);
  },
  onMenuChanged: function(id) {
    var api = {
      home:      '/statuses/home_timeline.xml',
      replies:   '/statuses/replies.xml',
      messages:  '/direct_messages.xml',
      favorites: '/favorites.xml',
      everyone:  '/statuses/public_timeline.xml',
    };

    var handler = {
      onSuccess: function(xhr) {
	this.error[id] = undefined;
	this.cache[id] = xhr.responseXML.elem('status').map(Twitter.Status);
	this.view.update(this.cache);
	this.msg.hide();
      },
      onFailure: function(xhr) {
	this.error[id] = xhr.status;
	this.msg.text = (App.dic.error[xhr.status] || App.dic.error.net).fill(xhr);
      },
      onComplete: function() {
	this.request[id] = undefined;
      }
    };

    this.msg.hide();
    this.view.update(this.cache);

    if (this.request[id]) {
      this.msg.text = App.dic.request[this.request[id]];
    } else if (this.error[id]) {
      this.msg.text = App.dic.error[this.error[id]];
    } else if (this.cache[id]) {
      this.view.update(this.cache);
    } else {
      if (id == 'everyone') {
	this.request[id] = 'loading';
	this.msg.text = App.dic.request.loading;
	this.twitter._get(api[id]).observe(handler, this);
      } else if (this.hasAccountSetting) {
	this.request[id] = 'loading';
	this.msg.text = App.dic.request.loading;
	this.twitter.get(api[id]).observe(handler, this);
      } else {
	this.error[id] = 'setting';
	this.msg.text = App.dic.error.setting;
      }
    }
  }
}

new App.Controller;

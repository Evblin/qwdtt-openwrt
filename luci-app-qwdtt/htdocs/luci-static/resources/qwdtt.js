'use strict';

'require fs';
'require rpc';
'require uci';
'require baseclass';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

var callLogRead = rpc.declare({
	object: 'log',
	method: 'read',
	params: [ 'lines', 'stream', 'oneshot' ],
	expect: { log: [] },
	reject: true
});

var callFileExec = rpc.declare({
	object: 'file',
	method: 'exec',
	params: [ 'command', 'params', 'env' ],
	expect: { '': {} },
	reject: true
});

var callRcInit = rpc.declare({
	object: 'rc',
	method: 'init',
	params: [ 'name', 'action' ]
});

var WORKER_GROUP = 9;
var MAX_WORKERS = 108;
var ACCOUNT_MAX_WORKERS = 4;

var DNS_PRESETS = [ 'yandex', 'cloudflare', 'google', 'doh-yandex', 'doh-cloudflare', 'doh-google' ];
var OBFS_PRESETS = [ 'audio', 'video' ];
var CAPTCHA_PRESETS = [ 'auto', 'wv', 'rjs' ];
var VK_AUTH_PRESETS = [ 'anonymous', 'account' ];
var VK_ANON_PATH_PRESETS = [ 'vkcalls', 'legacy' ];

var FIELD_KEYS = [
	'peer', 'hashes', 'password', 'device_id', 'workers', 'dns', 'obfs',
	'captcha_mode', 'vk_auth', 'vk_anon_path', 'no_dtls', 'turn_tcp',
	'tun_name', 'lan_interface'
];

(function() {
	var id = 'qwdtt-stylesheet';
	if (typeof document === 'undefined' || document.getElementById(id))
		return;

	var res = (L && L.env && L.env.resource) ? String(L.env.resource).replace(/\/$/, '') : null;
	if (!res)
		return;

	var link = document.createElement('link');
	link.id = id;
	link.rel = 'stylesheet';
	link.href = res + '/qwdtt.css';
	document.head.appendChild(link);
})();

function splitHashes(text) {
	if (typeof text !== 'string')
		return [];

	return text.split(/[\s,;]+/).filter(function(s) {
		return s.trim() !== '';
	});
}

function parseQwdttUri(text) {
	var q = text.indexOf('?');
	if (q === -1)
		return null;

	var params = {};
	var pairs = text.substring(q + 1).split('&');

	for (var i = 0; i < pairs.length; i++) {
		var eq = pairs[i].indexOf('=');
		if (eq === -1)
			continue;
		var key = pairs[i].substring(0, eq);
		var value = pairs[i].substring(eq + 1);

		try {
			value = decodeURIComponent(value.replace(/\+/g, ' '));
		}
		catch (e) {}

		if (key !== '')
			params[key] = value;
	}

	var peer = params.peer || '';
	if (peer.trim() === '')
		return null;

	var workers = parseInt(params.workers, 10);
	if (isNaN(workers))
		workers = 9;

	return {
		name: params.name || '',
		peer: peer.trim(),
		hashes: splitHashes(params.hashes || ''),
		workers: workers,
		password: params.pass || params.password || ''
	};
}

function importFirstProfile(list) {
	for (var i = 0; i < list.length; i++) {
		var p = list[i];
		if (!p || typeof p.peer !== 'string' || p.peer.trim() === '')
			continue;

		var workers = parseInt(p.workers != null ? p.workers : p.workersPerHash, 10);

		if (isNaN(workers))
			workers = 9;

		return {
			name: (typeof p.name === 'string') ? p.name : '',
			peer: p.peer.trim(),
			hashes: splitHashes(p.hashes != null ? p.hashes : p.vkHashes),
			workers: workers,
			password: (typeof p.password === 'string') ? p.password :
				(typeof p.pass === 'string' ? p.pass : '')
		};
	}

	return null;
}

function parseImport(row) {
	if (typeof row !== 'string' || row.trim() === '')
		return null;

	var text = row.trim();

	if (!text.startsWith('[') && !text.startsWith('{') && !text.startsWith('qwdtt:')) {
		try {
			var binary = atob(text);
			var bytes = new Uint8Array(binary.length);

			for (var i = 0; i < binary.length; i++)
				bytes[i] = binary.charCodeAt(i);

			text = new TextDecoder('utf-8').decode(bytes).trim();
		}
		catch (e) {}
	}

	if (!text.startsWith('qwdtt://'))
		text = text.replace('qwdtt:config', 'qwdtt://config');

	if (text.startsWith('qwdtt://config'))
		return parseQwdttUri(text);

	var data = null;
	try {
		data = JSON.parse(text);
	}
	catch (e) {
		return null;
	}

	var list = null;
	if (Array.isArray(data))
		list = data;
	else if (data && Array.isArray(data.profiles))
		list = data.profiles;
	else if (data && Array.isArray(data.servers))
		list = data.servers;

	if (!list || list.length === 0)
		return null;

	return importFirstProfile(list);
}

function load() {
	return uci.load('qwdtt');
}

function getConfigPath() {
	var path = uci.get('qwdtt', 'main', 'config');
	return path || '/etc/qwdtt/config.json';
}

function getEnabled() {
	return load().then(function() {
		var v = uci.get('qwdtt', 'main', 'enabled');
		return (v == '1' || v == 1 || v === true);
	});
}

function setEnabled(bool) {
	return load().then(function() {
		uci.set('qwdtt', 'main', 'enabled', bool ? '1' : '0');
		return uci.save();
	}).then(function() {
		return uci.apply(10);
	});
}

function readConfig() {
	return load().then(function() {
		return fs.read(getConfigPath());
	}).then(function(raw) {
		var cfg = null;
		try {
			cfg = JSON.parse(raw || '{}');
		}
		catch (e) {
			return { __error: 'Could not parse the configuration file' };
		}
		return cfg;
	}).catch(function() {
		return { __error: 'Configuration file is missing or unreadable' };
	});
}

function writeConfig(data) {
	return load().then(function() {
		return fs.write(getConfigPath(), JSON.stringify(data, null, 2) + '\n', 384);
	});
}

function serviceInfo() {
	return load().then(function() {
		var cfgPath = getConfigPath();
		return getEnabled().then(function(enabled) {
			return callServiceList('qwdtt').then(function(res) {
				var svc = (res != null && L.isObject(res)) ? res[ 'qwdtt' ] : null;
				if (svc == null || !L.isObject(svc.instances))
					return { enabled: enabled, running: false, configPath: cfgPath };

				var instances = svc.instances;
				var running = Object.keys(instances).some(function(name) {
					return !!(instances[name] && instances[name].running);
				});

				return { enabled: enabled, running: running, configPath: cfgPath };
			});
		});
	});
}

function serviceAction(action) {
	return callRcInit('qwdtt', action).then(function(ret) {
		if (ret)
			throw new Error('Command failed: ' + action);
		return serviceInfo();
	});
}

function getTunInfo(tunName) {
	return callFileExec('/sbin/ip', [ '-4', '-o', 'addr', 'show', 'dev', tunName ]).then(function(res) {
		var lines = String(res.stdout || '').split('\n');
		for (var i = 0; i < lines.length; i++) {
			var m = lines[i].match(/inet\s+([0-9a-fA-F:.]+\/[0-9]+)/);
			if (m)
				return { address: m[1] };
		}
		return null;
	});
}

function getRoutes(tunName) {
	return callFileExec('/sbin/ip', [ '-4', 'route', 'show', 'table', 'all' ]).then(function(res) {
		var out = [];
		var lines = String(res.stdout || '').split('\n');
		for (var i = 0; i < lines.length; i++) {
			if (tunName && lines[i].indexOf(tunName) !== -1)
				out.push(lines[i]);
		}
		return out;
	});
}

function getRules() {
	return callFileExec('/sbin/ip', [ '-4', 'rule', 'show' ]).then(function(res) {
		var out = [];
		var lines = String(res.stdout || '').split('\n');
		for (var i = 0; i < lines.length; i++)
			if (lines[i].trim() !== '')
				out.push(lines[i]);
		return out;
	});
}

function getTraffic(tunName) {
	return fs.read('/proc/net/dev').then(function(raw) {
		var prefix = tunName + ':';
		var lines = String(raw || '').split('\n');
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (line.indexOf(prefix) !== 0)
				continue;
			var f = line.replace(prefix, '').trim().split(/\s+/);
			return { rxBytes: +f[0] || 0, txBytes: +f[8] || 0 };
		}
		return null;
	});
}

function readLogs(lines) {
	return callLogRead(lines || 200, false, true).then(function(res) {
		var content = [];

		if (res && Array.isArray(res.log)) {
			content = res.log;
		}
		else if (res && Array.isArray(res.loglist)) {
			content = res.loglist;
		}
		else if (res && typeof res.log === 'string') {
			content = res.log.split('\n');
		}

		var out = [];
		for (var j = 0; j < content.length; j++) {
			var msg = typeof content[j] === 'string' ? content[j] : (content[j] && content[j].msg);
			if (typeof msg !== 'string')
				continue;
			if (msg.toLowerCase().indexOf('qwdtt') !== -1)
				out.push(msg);
		}
		return out;
	});
}

function execLong(promiseFn) {
	var old = L.env.rpctimeout;
	L.env.rpctimeout = 180;
	return promiseFn().then(function(result) {
		L.env.rpctimeout = old;
		return result;
	}, function(err) {
		L.env.rpctimeout = old;
		throw err;
	});
}

function checkHashes() {
	return execLong(function() {
		return callFileExec('/usr/bin/qwdtt-client', [ '-config', getConfigPath(), '-check-hashes' ]).then(function(res) {
			var rows = [];
			var lines = String(res.stdout || '').split('\n');
			for (var i = 0; i < lines.length; i++) {
				var parts = lines[i].split('|');
				if (parts[0] === 'HASH_CHECK' && parts.length >= 5)
					rows.push({
						index: +parts[1],
						hash: parts[2],
						status: parts[3],
						message: parts.slice(4).join('|')
					});
			}
			return { rows: rows, code: res.code, stderr: res.stderr || '' };
		});
	});
}

function selfTest(ip) {
	return execLong(function() {
		return callFileExec('/usr/bin/qwdtt-client', [ '-config', getConfigPath(), '-rawtun-self-test', ip ]).then(function(res) {
			return { code: res.code, stdout: res.stdout || '', stderr: res.stderr || '' };
		});
	});
}

function getInterfaces() {
	return fs.read('/proc/net/dev').then(function(raw) {
		var out = [];
		var lines = String(raw || '').split('\n');
		for (var i = 2; i < lines.length; i++) {
			var idx = lines[i].indexOf(':');
			if (idx === -1)
				continue;
			var name = lines[i].substring(0, idx).trim();
			if (name === 'lo')
				continue;
			var part = lines[i].substring(idx + 1).trim().split(/\s+/);
			out.push({ name: name, rxBytes: +part[0] || 0 });
		}
		out.sort(function(a, b) { return b.rxBytes - a.rxBytes; });
		return out;
	});
}

function formatRate(bytesPerSec) {
	return formatBytes(bytesPerSec) + '/s';
}

function formatBytes(n) {
	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
	var i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

function validateConfig(cfg) {
	var errors = [];
	var warnings = [];

	if (typeof cfg !== 'object' || cfg == null) {
		return { valid: false, errors: [ _('Configuration is empty') ], warnings: warnings };
	}

	if (typeof cfg.peer !== 'string' || cfg.peer.trim() === '') {
		errors.push(_('Server address (peer) is required'));
	}
	else {
		var m = cfg.peer.trim().match(/^(\[[0-9a-fA-F:.]+\]|[^:\[\]]+):(\d{1,5})$/);
		if (!m || +m[2] < 1 || +m[2] > 65535)
			errors.push(_('Server address must look like host:port with a valid port'));
	}

	if (!Array.isArray(cfg.hashes) || cfg.hashes.length === 0) {
		errors.push(_('At least one VK hash is required'));
	}
	else {
		var seen = {};
		for (var i = 0; i < cfg.hashes.length; i++) {
			var h = (typeof cfg.hashes[i] === 'string') ? cfg.hashes[i].trim() : '';
			if (h === '')
				errors.push(_('VK hashes must not contain empty entries'));
			else if (seen[h])
				errors.push(_('Duplicate VK hash: %s').format(h));
			else
				seen[h] = true;
		}
	}

	if (typeof cfg.password !== 'string' || cfg.password === '')
		errors.push(_('Connection password is required'));

	var workers = cfg.workers;
	if (workers == null || workers === '')
		workers = WORKER_GROUP;
	workers = parseInt(workers, 10);
	if (isNaN(workers) || workers < 1)
		errors.push(_('Worker count must be a positive integer'));
	else if (workers > MAX_WORKERS)
		errors.push(_('Worker count may not exceed %d').format(MAX_WORKERS));

	var vkAuth = cfg.vk_auth || 'anonymous';
	if (VK_AUTH_PRESETS.indexOf(vkAuth) === -1) {
		errors.push(_('Unknown VK auth mode: %s').format(vkAuth));
	}
	else if (!isNaN(workers)) {
		if (vkAuth === 'account') {
			if (workers > ACCOUNT_MAX_WORKERS)
				errors.push(_('Account mode supports at most %d workers').format(ACCOUNT_MAX_WORKERS));
		}
		else if (workers < WORKER_GROUP || workers % WORKER_GROUP !== 0) {
			errors.push(_('Anonymous mode requires a worker count divisible by %d').format(WORKER_GROUP));
		}
	}

	var dns = cfg.dns || 'yandex';
	if (DNS_PRESETS.indexOf(dns) === -1 &&
	    dns.indexOf('custom:') !== 0 && dns.indexOf('doh:') !== 0)
		errors.push(_('Unknown DNS setting: %s').format(dns));

	var obfs = cfg.obfs || 'audio';
	if (OBFS_PRESETS.indexOf(obfs) === -1)
		errors.push(_('Unknown obfuscation mode: %s').format(obfs));

	var captcha = cfg.captcha_mode || 'auto';
	if (CAPTCHA_PRESETS.indexOf(captcha) === -1)
		errors.push(_('Unknown captcha mode: %s').format(captcha));

	if (VK_AUTH_PRESETS.indexOf(cfg.vk_auth) === -1 && cfg.vk_auth != null && cfg.vk_auth !== '')
		errors.push(_('Unknown VK auth mode: %s').format(cfg.vk_auth));

	var anonPath = cfg.vk_anon_path || 'vkcalls';
	if (VK_ANON_PATH_PRESETS.indexOf(anonPath) === -1)
		errors.push(_('Unknown anonymous VK path: %s').format(anonPath));

	if (cfg.no_dtls != null && typeof cfg.no_dtls !== 'boolean')
		errors.push(_('no_dtls must be a boolean value'));
	if (cfg.turn_tcp != null && typeof cfg.turn_tcp !== 'boolean')
		errors.push(_('turn_tcp must be a boolean value'));

	if (cfg.tun_name != null && cfg.tun_name !== '' &&
	    !cfg.tun_name.match(/^[A-Za-z0-9_.:-]{1,15}$/))
		errors.push(_('Invalid TUN interface name: %s').format(cfg.tun_name));

	if (cfg.lan_interface != null && cfg.lan_interface !== '' &&
	    !cfg.lan_interface.match(/^[A-Za-z0-9_.:-]{1,15}$/))
		errors.push(_('Invalid LAN interface name: %s').format(cfg.lan_interface));

	if (typeof cfg.device_id === 'string' && cfg.device_id.length > 64)
		warnings.push(_('Device ID is unusually long'));

	return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

function normalizedConfig(cfg) {
	var out = {};
	for (var i = 0; i < FIELD_KEYS.length; i++) {
		var key = FIELD_KEYS[i];
		if (key in cfg)
			out[key] = cfg[key];
	}
	for (key in cfg) {
		if (FIELD_KEYS.indexOf(key) === -1)
			out[key] = cfg[key];
	}
	return out;
}

return baseclass.extend({
	load: load,
	getConfigPath: getConfigPath,
	getEnabled: getEnabled,
	setEnabled: setEnabled,
	readConfig: readConfig,
	writeConfig: writeConfig,
	serviceInfo: serviceInfo,
	serviceAction: serviceAction,
	getTunInfo: getTunInfo,
	getRoutes: getRoutes,
	getRules: getRules,
	getTraffic: getTraffic,
	getInterfaces: getInterfaces,
	readLogs: readLogs,
	checkHashes: checkHashes,
	selfTest: selfTest,
	formatBytes: formatBytes,
	formatRate: formatRate,
	parseImport: parseImport,
	validateConfig: validateConfig,
	normalizedConfig: normalizedConfig,
	FIELD_KEYS: FIELD_KEYS
});
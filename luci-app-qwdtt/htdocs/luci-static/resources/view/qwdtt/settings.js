'use strict';

'require view';
'require ui';
'require qwdtt';

var DNS_PRESETS = [ 'yandex', 'cloudflare', 'google', 'doh-yandex', 'doh-cloudflare', 'doh-google' ];
var WORKER_PRESETS = [ 9, 18, 27, 36, 54, 72, 90, 108 ];

function fieldRow(label, control, hint) {
	var cell = E('div', { 'class': 'cbi-value-field' }, [ control ]);
	if (hint)
		cell.appendChild(E('div', { 'class': 'cbi-value-description' }, [ hint ]));

	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, [ label ]),
		cell
	]);
}

function selectControl(value, options) {
	var sel = E('select', { 'class': 'cbi-input-select' });
	for (var i = 0; i < options.length; i++) {
		var opt = E('option', { 'value': options[i][0] }, [ options[i][1] ]);
		if (options[i][0] === value)
			opt.selected = true;
		sel.appendChild(opt);
	}
	return sel;
}

function textControl(value, type) {
	var input = E('input', {
		'class': 'cbi-input-text',
		'type': type || 'text',
		'value': value == null ? '' : value
	});
	return input;
}

function boolControl(value) {
	var input = E('input', { 'type': 'checkbox' });
	input.checked = !!value;
	return input;
}

function datalist(id, options) {
	var list = E('datalist', { 'id': id });
	for (var i = 0; i < options.length; i++)
		list.appendChild(E('option', { 'value': options[i] }));
	return list;
}

function section(title, body) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h2', {}, [ title ]),
		E('div', { 'class': 'cbi-section-node' }, [ body ])
	]);
}

return view.extend({
	handleSaveApply: null,

	__fields: null,
	__hashInputs: null,
	__original: null,
	__errorsEl: null,
	__root: null,

	load: function() {
		return Promise.all([
			qwdtt.load(),
			qwdtt.readConfig(),
			qwdtt.getInterfaces().catch(function() { return []; })
		]).then(function(results) {
			var cfg = results[1];
			if (cfg && cfg.__error)
				return { error: cfg.__error, path: qwdtt.getConfigPath(), interfaces: results[2] };

			return { cfg: cfg || {}, path: qwdtt.getConfigPath(), interfaces: results[2] };
		}).catch(function(err) {
			return { error: err && err.message ? err.message : String(err), interfaces: [] };
		});
	},

	render: function(data) {
		var vm = this;

		if (data.error) {
			return E('div', { 'class': 'alert-message error' }, [
				_('Unable to read the configuration:'), ' ', data.error,
				E('br'),
				E('span', { 'class': 'qwdtt-mono' }, [ data.path || qwdtt.getConfigPath() ])
			]);
		}

		var cfg = data.cfg;
		this.__original = cfg;
		this.__fields = {};
		this.__hashInputs = [];

		var fields = this.__fields;
		var ifaces = (data.interfaces || []).map(function(i) { return i.name; });

		fields.peer = textControl(cfg.peer);
		fields.device_id = textControl(cfg.device_id);
		fields.tun_name = textControl(cfg.tun_name);

		var workerInput = textControl(cfg.workers != null ? cfg.workers : 9, 'number');
		fields.workers = workerInput;

		var chips = E('div', { 'class': 'qwdtt-chips' });
		this.__chips = chips;
		for (var c = 0; c < WORKER_PRESETS.length; c++) {
			(function(n) {
				var b = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button' }, [ String(n) ]);
				if (String(cfg.workers) === String(n))
					b.classList.add('qwdtt-chip-active');
				b.addEventListener('click', function() {
					workerInput.value = String(n);
					for (var k = 0; k < chips.childNodes.length; k++)
						chips.childNodes[k].classList.remove('qwdtt-chip-active');
					b.classList.add('qwdtt-chip-active');
				});
				chips.appendChild(b);
			})(WORKER_PRESETS[c]);
		}

		fields.password = textControl(cfg.password, 'password');
		var pwBtn = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button' }, [ _('Show') ]);
		pwBtn.addEventListener('click', function() {
			if (fields.password.type === 'password') {
				fields.password.type = 'text';
				L.dom.content(pwBtn, _('Hide'));
			}
			else {
				fields.password.type = 'password';
				L.dom.content(pwBtn, _('Show'));
			}
		});
		var pwWrap = E('div', { 'class': 'qwdtt-pw' }, [ fields.password, pwBtn ]);

		var dnsInput = textControl(cfg.dns || 'yandex');
		dnsInput.setAttribute('list', 'qwdtt-dns-presets');
		fields.dns = dnsInput;

		var lanInput = textControl(cfg.lan_interface);
		lanInput.setAttribute('list', 'qwdtt-lan-list');
		fields.lan_interface = lanInput;

		fields.obfs = selectControl(cfg.obfs || 'audio', [
			[ 'audio', _('audio') ],
			[ 'video', _('video') ]
		]);
		fields.captcha_mode = selectControl(cfg.captcha_mode || 'auto', [
			[ 'auto', _('auto') ],
			[ 'wv', _('wv (WebView)') ],
			[ 'rjs', _('rjs') ]
		]);
		fields.vk_auth = selectControl(cfg.vk_auth || 'anonymous', [
			[ 'anonymous', _('anonymous') ],
			[ 'account', _('account') ]
		]);
		fields.vk_anon_path = selectControl(cfg.vk_anon_path || 'vkcalls', [
			[ 'vkcalls', _('vkcalls') ],
			[ 'legacy', _('legacy') ]
		]);
		fields.no_dtls = boolControl(cfg.no_dtls);
		fields.turn_tcp = boolControl(cfg.turn_tcp);

		var hashList = E('div', { 'class': 'qwdtt-hash-list' });
		var hashValues = Array.isArray(cfg.hashes) ? cfg.hashes : [];

		function addHashRow(value) {
			var input = textControl(value);
			var row = E('div', { 'class': 'qwdtt-hash-row' }, [
				input,
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'click': function(ev) {
						ev.preventDefault();
						row.parentNode.removeChild(row);
						var idx = vm.__hashInputs.indexOf(input);
						if (idx !== -1)
							vm.__hashInputs.splice(idx, 1);
					}
				}, [ _('Remove') ])
			]);
			vm.__hashInputs.push(input);
			hashList.appendChild(row);
		}

		vm.__hashList = hashList;
		vm.__addHashRow = addHashRow;

		if (hashValues.length === 0)
			addHashRow('');
		else
			for (var h = 0; h < hashValues.length; h++)
				addHashRow(hashValues[h]);

		var addHashBtn = E('button', {
			'class': 'cbi-button cbi-button-add',
			'click': function(ev) {
				ev.preventDefault();
				addHashRow('');
			}
		}, [ _('Add VK hash') ]);

		var errorsEl = E('div', { 'class': 'qwdtt-errors' });
		this.__errorsEl = errorsEl;

		var importArea = E('textarea', {
			'class': 'cbi-input-textarea qwdtt-import-area',
			'rows': 2,
			'placeholder': _('Profile link or JSON')
		});

		var importResult = E('div', { 'class': 'qwdtt-import-result' });

		var importBtn = E('button', {
			'class': 'cbi-button cbi-button-action',
			'click': function(ev) {
				ev.preventDefault();
				vm.doImport(importArea, importResult);
			}
		}, [ _('Import') ]);

		var importSection = section(_('Quick import'), E('div', {}, [
			fieldRow(_('Profile link or JSON'), E('div', {}, [
				importArea, ' ', importBtn
			]),
				_('Paste a qWDTT profile link (qwdtt://config), JSON or base64 copied from the Android app.')),
			importResult
		]));

		var saveRestartBtn = E('button', {
			'class': 'cbi-button cbi-button-apply important',
			'click': function(ev) {
				ev.preventDefault();
				vm.saveAndRestart();
			}
		}, [ _('Save & Restart') ]);

		var advanced = E('details', { 'class': 'qwdtt-advanced' }, [
			E('summary', {}, [ _('Advanced') ]),
			E('div', {}, [
				fieldRow(_('TUN interface'), fields.tun_name,
					_('Name of the RAW TUN interface created on this router.')),
				fieldRow(_('Disable DTLS'), fields.no_dtls,
					_('Direct mode: RTP-obfuscation AEAD without DTLS (server must listen in direct mode).')),
				fieldRow(_('TURN over TCP'), fields.turn_tcp,
					_('Connect to the TURN relay over TCP instead of UDP.'))
			])
		]);

		var root = E('div', { 'class': 'qwdtt-settings' }, [
			errorsEl,
			importSection,
			E('div', { 'class': 'alert-message notice' }, [
				_('The client reads this file only at startup. Use “Save & Restart” to apply changes immediately.')
			]),
			section(_('Connection'), E('div', {}, [
				fieldRow(_('Server address (host:port)'), fields.peer,
					_('Example: 203.0.113.10:56003. Ports: DTLS 56000, direct 56002, raw TUN 56003.')),
				fieldRow(_('VK call hashes'), E('div', {}, [ hashList, addHashBtn ]),
					_('One hash per entry. The server selects a working call automatically.')),
				fieldRow(_('Connection password'), pwWrap,
					_('Used to derive the WRAP key; must match the server password.'))
			])),
			section(_('VK and workers'), E('div', {}, [
				fieldRow(_('VK authorization'), fields.vk_auth,
					_('Anonymous mode uses public call links; account mode uses your VK credentials.')),
				fieldRow(_('Anonymous VK path'), fields.vk_anon_path,
					_('Used only in anonymous mode.')),
				fieldRow(_('Captcha mode'), fields.captcha_mode,
					_('How the client solves VK captchas.')),
				fieldRow(_('Workers'), E('div', {}, [ workerInput, chips ]),
					_('Anonymous mode: 9, 18, ... 108. Account mode: 1 to 4.'))
			])),
			section(_('Network'), E('div', {}, [
				fieldRow(_('DNS for VK'), E('div', {}, [ dnsInput, datalist('qwdtt-dns-presets', DNS_PRESETS) ]),
					_('Preset name, custom:<IP> or doh:<URL>.')),
				fieldRow(_('Obfuscation'), fields.obfs, null),
				fieldRow(_('LAN interface'), E('div', {}, [ lanInput, datalist('qwdtt-lan-list', ifaces) ]),
					_('LAN interface whose traffic is routed through the tunnel.')),
				advanced
			])),
			section(_('Device'), E('div', {}, [
				fieldRow(_('Device ID'), fields.device_id,
					_('Identifier reported to the server. Defaults to “openwrt” when empty.'))
			])),
			E('div', { 'class': 'cbi-page-actions' }, [
				saveRestartBtn
			]),
			E('div', { 'class': 'cbi-value-description' }, [
				_('Configuration file:'), ' ',
				E('span', { 'class': 'qwdtt-mono' }, [ data.path ])
			])
		]);

		this.__root = root;
		return root;
	},

	gather: function() {
		var f = this.__fields;
		var hashes = [];
		for (var i = 0; i < this.__hashInputs.length; i++) {
			var v = this.__hashInputs[i].value.trim();
			if (v !== '')
				hashes.push(v);
		}

		var workers = parseInt(f.workers.value, 10);
		if (isNaN(workers))
			workers = 9;

		return {
			peer: f.peer.value.trim(),
			hashes: hashes,
			password: f.password.value,
			device_id: f.device_id.value.trim(),
			workers: workers,
			dns: f.dns.value.trim(),
			obfs: f.obfs.value,
			captcha_mode: f.captcha_mode.value,
			vk_auth: f.vk_auth.value,
			vk_anon_path: f.vk_anon_path.value,
			no_dtls: !!f.no_dtls.checked,
			turn_tcp: !!f.turn_tcp.checked,
			tun_name: f.tun_name.value.trim(),
			lan_interface: f.lan_interface.value.trim()
		};
	},

	showErrors: function(errors, warnings) {
		var el = this.__errorsEl;
		while (el.firstChild)
			el.removeChild(el.firstChild);

		if (errors && errors.length) {
			var list = E('ul', {});
			for (var i = 0; i < errors.length; i++)
				list.appendChild(E('li', {}, [ errors[i] ]));
			el.appendChild(E('div', { 'class': 'alert-message error' }, [
				E('strong', {}, [ _('Please fix the following problems:') ]),
				list
			]));
		}

		if (warnings && warnings.length) {
			var wlist = E('ul', {});
			for (var j = 0; j < warnings.length; j++)
				wlist.appendChild(E('li', {}, [ warnings[j] ]));
			el.appendChild(E('div', { 'class': 'alert-message warning' }, [ wlist ]));
		}
	},

	doSave: function() {
		var vm = this;

		if (!this.__fields)
			return Promise.resolve(null);

		var gathered = this.gather();
		var base = (this.__original && !this.__original.__error) ? this.__original : {};
		var merged = qwdtt.normalizedConfig(Object.assign({}, base, gathered));
		var result = qwdtt.validateConfig(merged);

		this.showErrors(result.errors, result.warnings);

		if (!result.valid) {
			ui.addNotification(null, E('p', {}, [ _('Configuration was not saved: validation failed.') ]), 'error', 8000);
			return Promise.resolve(null);
		}

		return qwdtt.writeConfig(merged).then(function() {
			vm.__original = merged;
			ui.addNotification(null, E('p', {}, [
				_('Configuration saved. Restart the service to apply the changes.')
			]), 'info', 8000);
			return merged;
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [
				_('Unable to save the configuration:'), ' ',
				(err && err.message) ? err.message : String(err)
			]), 'error', 10000);
			return null;
		});
	},

	saveAndRestart: function() {
		return this.doSave().then(function(saved) {
			if (!saved)
				return;

			return qwdtt.serviceInfo().then(function(info) {
				if (!info.enabled) {
					ui.addNotification(null, E('p', {}, [
						_('Saved. The service is disabled, so it was not started.')
					]), 'warning', 8000);
					return;
				}

				return qwdtt.serviceAction('restart').then(function() {
					ui.addNotification(null, E('p', {}, [ _('Service restarted.') ]), 'info', 5000);
				});
			});
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [
				_('An error occurred:'), ' ',
				(err && err.message) ? err.message : String(err)
			]), 'error', 10000);
		});
	},

	discard: function() {
		var vm = this;

		if (!vm.__original)
			return;

		var data = { cfg: vm.__original, path: qwdtt.getConfigPath() };
		var doc = vm.render(data);
		var vp = document.getElementById('view');
		L.dom.content(vp, doc);
		L.dom.append(vp, vm.addFooter());
	},

	handleSave: function() {
		return this.doSave();
	},

	doImport: function(input, resultEl) {
		var text = input.value || '';

		if (!this.__fields)
			return;

		while (resultEl.firstChild)
			resultEl.removeChild(resultEl.firstChild);

		var imported = qwdtt.parseImport(text);
		if (!imported) {
			resultEl.appendChild(E('div', { 'class': 'alert-message error' }, [
				_('Unable to import: no valid qWDTT profile link, JSON file or base64 payload was recognized.')
			]));
			return;
		}

		var f = this.__fields;
		f.peer.value = imported.peer;

		if (typeof imported.password === 'string')
			f.password.value = imported.password;

		if (typeof imported.workers === 'number')
			f.workers.value = String(imported.workers);

		for (var q = 0; q < this.__chips.childNodes.length; q++)
			this.__chips.childNodes[q].classList.remove('qwdtt-chip-active');
		for (q = 0; q < this.__chips.childNodes.length; q++) {
			if (this.__chips.childNodes[q].textContent === String(imported.workers)) {
				this.__chips.childNodes[q].classList.add('qwdtt-chip-active');
				break;
			}
		}

		while (this.__hashList.firstChild)
			this.__hashList.removeChild(this.__hashList.firstChild);

		this.__hashInputs.length = 0;

		if (imported.hashes && imported.hashes.length) {
			for (var i = 0; i < imported.hashes.length; i++)
				this.__addHashRow(imported.hashes[i]);
		}
		else {
			this.__addHashRow('');
		}

		var successNotice = E('div', { 'class': 'alert-message notice' }, [
			_('Imported profile: %s').format(imported.name ? imported.name : imported.peer),
			'. ',
			_('Review the filled fields and press “Save & Restart”.')
		]);

		if (!imported.password) {
			successNotice.appendChild(E('br'));
			successNotice.appendChild(E('div', { 'class': 'alert-message warning' }, [
				_('The imported payload contains no password; fill it in manually.')
			]));
		}

		resultEl.appendChild(successNotice);
	},

	handleReset: function() {
		this.discard();
	}
});
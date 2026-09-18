'use strict';

'require view';
'require ui';
'require qwdtt';

var LOG_MARKERS = [
	{ re: /\bTUN\b|трафик пошёл|RAW SELF-TEST\]\s*успешно|WRAP.*активен/i, cls: 'qwdtt-log-ok' },
	{ re: /ошибк|error|fatal|failed|failure|отклон|неверн|timeout|unreachable/i, cls: 'qwdtt-log-error' },
	{ re: /warning|предупрежд|капч|captcha|квота/i, cls: 'qwdtt-log-warn' }
];

function section(title, body) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h2', {}, [ title ]),
		E('div', { 'class': 'cbi-section-node' }, [ body ])
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

function statusClass(status) {
	switch (status) {
	case 'ok':
		return 'qwdtt-status-ok';
	case 'captcha':
	case 'limited':
		return 'qwdtt-status-warn';
	default:
		return 'qwdtt-status-error';
	}
}

function statusBadge(state) {
	return E('span', {
		'class': 'qwdtt-badge ' + (state ? 'qwdtt-badge-running' : 'qwdtt-badge-stopped')
	}, [ state ? _('Running') : _('Stopped') ]);
}

function summaryCard(label, value, sub) {
	return E('div', { 'class': 'qwdtt-summary-card' }, [
		E('div', { 'class': 'qwdtt-summary-label' }, [ label ]),
		E('div', { 'class': 'qwdtt-summary-value' }, [ value ]),
		sub ? E('div', { 'class': 'cbi-value-description' }, [ sub ]) : null
	]);
}

function hostFromPeer(peer) {
	if (typeof peer !== 'string')
		return '';
	return peer.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
}

function isValidIPv4(ip) {
	var parts = ip.split('.');
	if (parts.length !== 4)
		return false;
	for (var i = 0; i < 4; i++) {
		if (!/^\d{1,3}$/.test(parts[i]))
			return false;
		var n = +parts[i];
		if (n < 0 || n > 255)
			return false;
	}
	return true;
}

function logLineClass(line) {
	for (var i = 0; i < LOG_MARKERS.length; i++)
		if (LOG_MARKERS[i].re.test(line))
			return LOG_MARKERS[i].cls;
	return '';
}

function copyText(text) {
	if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
		return navigator.clipboard.writeText(text);

	return new Promise(function(resolve, reject) {
		try {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			var ok = document.execCommand('copy');
			document.body.removeChild(ta);
			if (ok)
				resolve();
			else
				reject(new Error('copy failed'));
		}
		catch (e) {
			reject(e);
		}
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	__summary: null,

	load: function() {
		return Promise.all([
			qwdtt.load(),
			qwdtt.readConfig()
		]).then(function(results) {
			var cfg = results[1] || {};
			return {
				cfg: cfg,
				peerHost: hostFromPeer(cfg.peer),
				err: cfg.__error || null
			};
		}).catch(function(err) {
			return { cfg: {}, peerHost: '', err: err && err.message ? err.message : String(err) };
		});
	},

	render: function(data) {
		var vm = this;

		var summaryEl = E('div', { 'class': 'qwdtt-summary' });
		var reportOut = E('pre', { 'class': 'qwdtt-pre', 'style': 'display: none;' });

		var refreshBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Refresh') ]);
		refreshBtn.addEventListener('click', function() { vm.loadSummary(summaryEl); });

		var copyBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Copy diagnostic report') ]);
		copyBtn.addEventListener('click', function() { vm.copyReport(copyBtn, reportOut); });

		var hashBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Check VK hashes') ]);
		var hashResult = E('div', { 'class': 'qwdtt-hash-result' });
		hashBtn.addEventListener('click', function() { vm.runHashCheck(hashBtn, hashResult); });

		var selfTestInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Tunnel IPv4 address, e.g. 10.70.0.2'),
			'value': '10.70.0.2'
		});
		var selfTestBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Run self-test') ]);
		var selfTestOut = E('pre', { 'class': 'qwdtt-pre' });
		selfTestBtn.addEventListener('click', function() { vm.runSelfTest(selfTestInput, selfTestBtn, selfTestOut); });

		var logLines = selectControl('200', [ [ '200', '200' ], [ '1000', '1000' ], [ '3000', '3000' ] ]);
		var logBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, [ _('Load log') ]);
		var logOut = E('pre', { 'class': 'qwdtt-pre qwdtt-log' });
		logBtn.addEventListener('click', function() { vm.loadLogs(logLines.value, logBtn, logOut); });

		var root = E('div', { 'class': 'qwdtt-diagnostics' }, [
			section(_('Status'), E('div', {}, [
				E('div', { 'class': 'cbi-page-actions' }, [ refreshBtn, copyBtn ]),
				summaryEl,
				reportOut
			])),
			section(_('VK hash check'), E('div', {}, [
				E('p', {}, [
					_('Queries VK for each configured hash and reports which calls are usable. This can take up to 90 seconds per hash.')
				]),
				E('div', { 'class': 'cbi-page-actions' }, [ hashBtn ]),
				hashResult
			])),
			section(_('RAW TUN self-test'), E('div', {}, [
				E('p', {}, [
					_('Creates a temporary TUN interface to verify that the RAW TUN mode can start. Stop the service before running this test.')
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('Tunnel IPv4 address') ]),
					E('div', { 'class': 'cbi-value-field' }, [
						selfTestInput, ' ', selfTestBtn
					])
				]),
				selfTestOut
			])),
			section(_('Service log'), E('div', {}, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ _('Number of lines') ]),
					E('div', { 'class': 'cbi-value-field' }, [ logLines, ' ', logBtn ])
				]),
				logOut
			]))
		]);

		vm.loadSummary(summaryEl);

		return root;
	},

	loadSummary: function(el) {
		var vm = this;
		L.dom.content(el, E('div', { 'class': 'spinning' }, [ _('Loading status…') ]));

		Promise.all([
			qwdtt.serviceInfo(),
			qwdtt.readConfig().catch(function() { return null; })
		]).then(function(r) {
			var info = r[0];
			var cfg = r[1] || {};
			var tunName = (typeof cfg.tun_name === 'string' && cfg.tun_name) || 'qwdtt0';

			return Promise.all([
				qwdtt.getTunInfo(tunName).catch(function() { return null; }),
				qwdtt.getTraffic(tunName).catch(function() { return null; }),
				qwdtt.getRules().catch(function() { return []; })
			]).then(function(items) {
				var tun = items[0], traffic = items[1], rules = items[2];

				var cards = [
					summaryCard(_('Service'), statusBadge(info.running), info.enabled ? _('Autostart: on') : _('Autostart: off')),
					summaryCard(_('TUN address'), tun ? tun.address : _('not configured'), tunName),
					summaryCard(_('Traffic'), E('div', {}, [
						E('span', {}, [ traffic ? qwdtt.formatBytes(traffic.rxBytes) : _('n/a') ]),
						' / ',
						E('span', {}, [ traffic ? qwdtt.formatBytes(traffic.txBytes) : _('n/a') ])
					]), _('received / sent')),
					summaryCard(_('Policy rules'), String(rules.length), null)
				];

				L.dom.content(el, E('div', { 'class': 'qwdtt-summary-grid' }, cards));

				vm.__summary = {
					info: info,
					cfg: cfg,
					tunName: tunName,
					tun: tun,
					traffic: traffic,
					rules: rules
				};
			});
		}).catch(function(err) {
			L.dom.content(el, E('div', { 'class': 'alert-message error' }, [
				(err && err.message) ? err.message : String(err)
			]));
		});
	},

	copyReport: function(btn, reportOut) {
		var vm = this;
		var s = this.__summary;

		if (!s) {
			ui.addNotification(null, E('p', {}, [ _('Status is not loaded yet.') ]), 'warning', 5000);
			return;
		}

		btn.disabled = true;

		qwdtt.readLogs(100).then(function(lines) {
			var cfg = s.cfg || {};
			var linesTxt = lines.length ? lines.join('\n') : '—';
			var report =
				_('qWDTT diagnostic report') + '\n' +
				'Generated: ' + new Date().toLocaleString() + '\n' +
				'----------------------------------------\n' +
				'Service: ' + (s.info.running ? 'running' : 'stopped') + ', autostart: ' + (s.info.enabled ? 'on' : 'off') + '\n' +
				'Config: ' + qwdtt.getConfigPath() + '\n' +
				'  peer: ' + (cfg.peer || '') + '\n' +
				'  device_id: ' + (cfg.device_id || '') + '\n' +
				'  workers: ' + (cfg.workers != null ? cfg.workers : '') + '\n' +
				'  obfs: ' + (cfg.obfs || '') + '\n' +
				'  vk_auth: ' + (cfg.vk_auth || '') + '\n' +
				'  hashes: ' + (Array.isArray(cfg.hashes) ? String(cfg.hashes.length) + ' (hidden)' : '0') + '\n' +
				'  lan_interface: ' + (cfg.lan_interface || '') + '\n' +
				'  tun: ' + s.tunName + (s.tun && s.tun.address ? ' = ' + s.tun.address : ' (not configured)') + '\n' +
				'Traffic: ' + (s.traffic ? qwdtt.formatBytes(s.traffic.rxBytes) : 'n/a') + ' rx / ' + (s.traffic ? qwdtt.formatBytes(s.traffic.txBytes) : 'n/a') + ' tx\n' +
				'Policy rules: ' + (s.rules ? String(s.rules.length) : '0') + '\n' +
				'----------------------------------------\n' +
				'Log tail (qwdtt only):\n' + linesTxt;

			return copyText(report).then(function() {
				ui.addNotification(null, E('p', {}, [ _('Report copied to clipboard.') ]), 'info', 5000);
			}).catch(function() {
				reportOut.style.display = '';
				reportOut.textContent = report;
				reportOut.className = 'qwdtt-pre qwdtt-log-warn';
				ui.addNotification(null, E('p', {}, [ _('Unable to copy the report automatically.') ]), 'warning', 8000);
			});
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [
				_('An error occurred:'), ' ',
				(err && err.message) ? err.message : String(err)
			]), 'error', 10000);
		}).then(function() {
			btn.disabled = false;
		});
	},

	runHashCheck: function(btn, result) {
		var vm = this;
		btn.disabled = true;
		L.dom.content(result, E('div', { 'class': 'spinning' }, [ _('Checking hashes…') ]));

		qwdtt.checkHashes().then(function(res) {
			btn.disabled = false;

			var rows = (res && res.rows) ? res.rows : [];

			if (!rows.length) {
				if (res && res.code != null && (res.code !== 0 || res.stderr)) {
					L.dom.content(result, E('div', { 'class': 'alert-message error' }, [
						_('The client failed (exit code %d):').format(res.code),
						E('pre', { 'class': 'qwdtt-pre' }, [
							res.stderr || _('The client produced no output.')
						])
					]));
					return;
				}

				L.dom.content(result, E('div', { 'class': 'alert-message warning' }, [
					_('No results. Make sure the client is installed and hashes are configured.')
				]));
				return;
			}

			var body = rows.map(function(r) {
				return E('tr', {}, [
					E('td', {}, [ String(r.index) ]),
					E('td', { 'class': 'qwdtt-mono' }, [ r.hash ]),
					E('td', { 'class': statusClass(r.status) }, [ r.status ]),
					E('td', {}, [ r.message ])
				]);
			});

			L.dom.content(result, E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [ '#' ]),
					E('th', { 'class': 'th' }, [ _('Hash') ]),
					E('th', { 'class': 'th' }, [ _('Status') ]),
					E('th', { 'class': 'th' }, [ _('Details') ])
				])
			].concat(body)));
		}).catch(function(err) {
			btn.disabled = false;
			vm.report(result, err);
		});
	},

	runSelfTest: function(input, btn, out) {
		var vm = this;
		var ip = input.value.trim();

		if (!isValidIPv4(ip)) {
			ui.addNotification(null, E('p', {}, [ _('Enter a valid IPv4 address.') ]), 'error', 6000);
			return;
		}

		L.dom.content(out, [ _('Running self-test…') ]);

		qwdtt.serviceInfo().then(function(info) {
			if (info.running)
				throw new Error(_('Stop the service before running the self-test.'));

			btn.disabled = true;
			return qwdtt.selfTest(ip);
		}).then(function(res) {
			btn.disabled = false;

			var lines = [];
			var split = (res.stdout + '\n' + res.stderr).split('\n');
			for (var i = 0; i < split.length; i++)
				if (split[i].trim() !== '')
					lines.push(split[i]);

			if (!lines.length)
				lines.push(_('The client produced no output.') + ' (exit code ' + res.code + ')');

			L.dom.content(out, [ lines.join('\n') ]);
			out.className = 'qwdtt-pre ' + (res.code === 0 ? 'qwdtt-log-ok' : 'qwdtt-log-error');
		}).catch(function(err) {
			btn.disabled = false;
			vm.report(out, err);
		});
	},

	loadLogs: function(count, btn, out) {
		var vm = this;
		btn.disabled = true;
		L.dom.content(out, [ _('Loading log…') ]);

		qwdtt.readLogs(+count).then(function(lines) {
			btn.disabled = false;

			while (out.firstChild)
				out.removeChild(out.firstChild);

			if (!lines.length) {
				out.appendChild(document.createElement('br'));
				out.appendChild(document.createTextNode(_('No qWDTT entries in the system log. The client may write to its own log or file; verify via: logread | grep -i qwdtt.')));
				out.appendChild(document.createElement('br'));
				out.appendChild(document.createTextNode(_('Start the service and then load the log again.')));
				return;
			}

			for (var i = 0; i < lines.length; i++) {
				var cls = logLineClass(lines[i]);
				if (cls)
					out.appendChild(E('span', { 'class': cls }, [ lines[i], '\n' ]));
				else
					out.appendChild(document.createTextNode(lines[i] + '\n'));
			}

			out.scrollTop = out.scrollHeight;
		}).catch(function(err) {
			btn.disabled = false;
			vm.report(out, err);
		});
	},

	report: function(target, err) {
		L.dom.content(target, E('div', { 'class': 'alert-message error' }, [
			(err && err.message) ? err.message : String(err)
		]));
	}
});
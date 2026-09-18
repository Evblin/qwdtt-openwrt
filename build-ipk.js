'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PKG = path.join(ROOT, 'luci-app-qwdtt');
const VERSION = process.env.PKG_VERSION || '1.0.0-1';
const OUT = path.join(ROOT, 'luci-app-qwdtt_' + VERSION + '_all.ipk');

/* ---------- sfh_hash (SuperFastHash, matches OpenWrt lmo) ---------- */

function get16(data, off) {
	return (data[off] + (data[off + 1] << 8)) & 0xffff;
}

function sfh_hash(data, len, init) {
	if (data == null || len <= 0)
		return 0;

	let hash = init >>> 0, tmp, rem, i = 0;
	rem = len & 3;
	len >>= 2;

	while (len-- > 0) {
		hash = (hash + get16(data, i)) >>> 0;
		tmp = (((get16(data, i + 2) << 11) ^ hash) >>> 0);
		hash = ((hash << 16) ^ tmp) >>> 0;
		i += 4;
		hash = (hash + (hash >>> 11)) >>> 0;
	}

	switch (rem) {
	case 3:
		hash = (hash + get16(data, i)) >>> 0;
		hash = (hash ^ (hash << 16)) >>> 0;
		hash = (hash ^ ((data[i + 2] < 128 ? data[i + 2] : data[i + 2] - 256) << 18)) >>> 0;
		hash = (hash + (hash >>> 11)) >>> 0;
		break;
	case 2:
		hash = (hash + get16(data, i)) >>> 0;
		hash = (hash ^ (hash << 11)) >>> 0;
		hash = (hash + (hash >>> 17)) >>> 0;
		break;
	case 1:
		hash = (hash + (data[i] < 128 ? data[i] : data[i] - 256)) >>> 0;
		hash = (hash ^ (hash << 10)) >>> 0;
		hash = (hash + (hash >>> 1)) >>> 0;
		break;
	}

	hash = (hash ^ (hash << 3)) >>> 0;
	hash = (hash + (hash >>> 5)) >>> 0;
	hash = (hash ^ (hash << 4)) >>> 0;
	hash = (hash + (hash >>> 17)) >>> 0;
	hash = (hash ^ (hash << 25)) >>> 0;
	hash = (hash + (hash >>> 6)) >>> 0;

	return hash >>> 0;
}

/* whitespace canonicalization identical to lmo_canon_hash (no ctx, plural=-1) */
function canonKey(key) {
	return key.replace(/\s+/g, ' ').replace(/^ /, '').replace(/ $/, '');
}

function hashKey(key) {
	const norm = canonKey(key);
	const buf = Buffer.from(norm, 'utf8');
	return sfh_hash(buf, buf.length, buf.length);
}

/* ---------- po parsing ---------- */

function parsePo(text) {
	const entries = [];
	let id = null, str = null, field = null;

	const unescape = s =>
		s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

	for (const line of text.split(/\r?\n/)) {
		if (/^msgid /.test(line)) {
			if (id != null) entries.push({ id, str: str == null ? '' : str });
			field = 'id';
			id = unescape(line.slice(6).replace(/^"|"$/g, ''));
			str = null;
		}
		else if (/^msgstr\s*"/.test(line)) {
			field = 'str';
			str = unescape(line.slice(7).replace(/^"|"$/g, ''));
		}
		else if (/^msgstr\[0\]/.test(line)) {
			field = 'str';
			str = unescape(line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).replace(/^"|"$/g, ''));
			str = unescape(line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')));
		}
		else if (/^"/.test(line) && field) {
			const part = unescape(line.replace(/^"|"$/g, ''));
			if (field === 'id') id += part;
			else if (field === 'str') str += part;
		}
	}
	if (id != null) entries.push({ id, str: str == null ? '' : str });

	return entries.filter(e => e.id !== '');
}

/* ---------- lmo builder ---------- */

function buildLmo(entries, pluralForms) {
	const items = [];

	if (pluralForms && pluralForms.length)
		items.push({ key: '', val: pluralForms, plural: true });

	for (const e of entries) {
		if (!e.str)
			continue;
		const keyBuf = Buffer.from(canonKey(e.id), 'utf8');
		const valBuf = Buffer.from(e.str, 'utf8');
		const keyHash = sfh_hash(keyBuf, keyBuf.length, keyBuf.length);
		const valHash = sfh_hash(valBuf, valBuf.length, valBuf.length);
		if (keyHash === valHash)
			continue;
		items.push({ key: e.id, val: e.str, plural: false, keyHash });
	}

	let blob = Buffer.alloc(0);
	const index = [];

	for (const it of items) {
		const buf = Buffer.from(it.val, 'utf8');
		const off = blob.length;
		blob = Buffer.concat([ blob, buf ]);
		const pad = (4 - (buf.length % 4)) % 4;
		if (pad)
			blob = Buffer.concat([ blob, Buffer.alloc(pad) ]);

		if (it.plural)
			index.push({ key_id: 0, val_id: 0, offset: off, length: buf.length });
		else
			index.push({ key_id: it.keyHash, val_id: 1, offset: off, length: buf.length });
	}

	index.sort((a, b) => a.key_id - b.key_id);

	const idx = Buffer.alloc(index.length * 16);
	index.forEach((e, i) => {
		const o = i * 16;
		idx.writeUInt32BE(e.key_id >>> 0, o);
		idx.writeUInt32BE(e.val_id >>> 0, o + 4);
		idx.writeUInt32BE(e.offset >>> 0, o + 8);
		idx.writeUInt32BE(e.length >>> 0, o + 12);
	});

	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(blob.length, 0);

	return { data: Buffer.concat([ blob, idx, tail ]), count: index.length };
}

/* ---------- tar writer (ustar) ---------- */

function tarHeader(name, mode, size, type) {
	const h = Buffer.alloc(512);
	const nameBuf = Buffer.from(name, 'utf8');
	if (nameBuf.length < 100)
		nameBuf.copy(h, 0);
	else {
		h.set(Buffer.alloc(512, 0));
		nameBuf.slice(0, 100).copy(h, 0);
	}

	function putOctal(off, len, val) {
		const s = val.toString(8);
		h.write(s, off, Math.min(len, s.length), 'ascii');
	}

	putOctal(100, 8, mode);          // mode
	putOctal(108, 6, 0);             // uid
	putOctal(114, 6, 0);             // gid
	putOctal(124, 12, size);         // size
	putOctal(136, 12, 0);            // mtime
	h.fill(0x20, 148, 156);          // chksum placeholder
	h[156] = type.charCodeAt(0);     // typeflag ('0' = reg, '5' = dir)

	const magic = Buffer.from('ustar\0', 'ascii');
	magic.copy(h, 257);
	h[263] = 0x30; h[264] = 0x30;    // version "00"
	Buffer.from('root', 'ascii').copy(h, 265, 0, 4);
	Buffer.from('root', 'ascii').copy(h, 297, 0, 4);

	let sum = 0;
	for (let i = 0; i < 512; i++)
		sum += h[i];
	const chk = sum.toString(8).padStart(6, '0');
	h.write(chk, 148, 6, 'ascii');
	h[154] = 0x00;
	h[155] = 0x20;

	return h;
}

function tarBytes(entries) {
	const chunks = [];
	for (const e of entries) {
		const data = e.type === 'dir' ? Buffer.alloc(0) : Buffer.from(e.data);
		chunks.push(tarHeader(e.name, e.mode, data.length, e.type === 'dir' ? '5' : '0'));
		chunks.push(data);
		if (data.length % 512)
			chunks.push(Buffer.alloc(512 - (data.length % 512)));
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}

/* ---------- assemble ---------- */

function buildIpk() {
	const tpl = path.join(PKG, 'po', 'templates', 'qwdtt.pot');
	if (!fs.existsSync(tpl)) throw new Error('missing ' + tpl);

	/* po is not needed for ipk; lmo is generated from ru po */
	const ruPo = path.join(PKG, 'po', 'ru', 'qwdtt.po');
	const entries = parsePo(fs.readFileSync(ruPo, 'utf8').replace(/^\uFEFF/, ''));

	const PLURAL = 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);';
	const lmo = buildLmo(entries, PLURAL);
	console.log('lmo entries: ' + lmo.count + ', size: ' + lmo.data.length);

	/* control */
	const files = {
		'usr/share/luci/menu.d/luci-app-qwdtt.json': fs.readFileSync(path.join(PKG, 'root', 'usr', 'share', 'luci', 'menu.d', 'luci-app-qwdtt.json')),
		'usr/share/rpcd/acl.d/luci-app-qwdtt.json': fs.readFileSync(path.join(PKG, 'root', 'usr', 'share', 'rpcd', 'acl.d', 'luci-app-qwdtt.json')),
		'usr/lib/lua/luci/i18n/qwdtt.ru.lmo': lmo.data,
		'www/luci-static/resources/qwdtt.js': fs.readFileSync(path.join(PKG, 'htdocs', 'luci-static', 'resources', 'qwdtt.js')),
		'www/luci-static/resources/qwdtt.css': fs.readFileSync(path.join(PKG, 'htdocs', 'luci-static', 'resources', 'qwdtt.css')),
		'www/luci-static/resources/view/qwdtt/overview.js': fs.readFileSync(path.join(PKG, 'htdocs', 'luci-static', 'resources', 'view', 'qwdtt', 'overview.js')),
		'www/luci-static/resources/view/qwdtt/settings.js': fs.readFileSync(path.join(PKG, 'htdocs', 'luci-static', 'resources', 'view', 'qwdtt', 'settings.js')),
		'www/luci-static/resources/view/qwdtt/diagnostics.js': fs.readFileSync(path.join(PKG, 'htdocs', 'luci-static', 'resources', 'view', 'qwdtt', 'diagnostics.js'))
	};

	let installed = 0;
	for (const k of Object.keys(files)) installed += files[k].length;

	const controlText =
		'Package: luci-app-qwdtt\n' +
		'Version: ' + VERSION + '\n' +
		'Depends: libc, luci-base\n' +
		'Source: feeds/luci/applications/luci-app-qwdtt\n' +
		'SourceName: luci-app-qwdtt\n' +
		'License: GPL-3.0-or-later\n' +
		'Section: luci\n' +
		'SourceDateEpoch: 1750000000\n' +
		'URL: https://github.com/SpaceNeuroX/qwdtt-openwrt\n' +
		'Maintainer: SpaceNeuroX\n' +
		'Architecture: all\n' +
		'Installed-Size: ' + Math.ceil(installed / 1024) + '\n' +
		'Description:  LuCI interface for the qWDTT client. Status, settings and\n' +
		'  diagnostics pages for the qWDTT OpenWrt VPN client.\n';

	const postinst =
		'#!/bin/sh\n' +
		'[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0\n' +
		'\n' +
		'rm -f /tmp/luci-indexcache.*\n' +
		'rm -rf /tmp/luci-modulecache/\n' +
		'/etc/init.d/rpcd reload 2>/dev/null\n' +
		'\n' +
		'exit 0\n';

	const prerm =
		'#!/bin/sh\n' +
		'[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0\n' +
		'\n' +
		'exit 0\n';

	const dirs = (p) => {
		const parts = p.split('/');
		const out = [];
		for (let i = 1; i <= parts.length; i++)
			out.push('./' + parts.slice(0, i).join('/'));
		return out;
	};

	const dataDirs = [ './', './usr/', './usr/share/', './usr/share/luci/', './usr/share/luci/menu.d/',
		'./usr/share/rpcd/', './usr/share/rpcd/acl.d/', './usr/lib/', './usr/lib/lua/', './usr/lib/lua/luci/',
		'./usr/lib/lua/luci/i18n/', './www/', './www/luci-static/', './www/luci-static/resources/',
		'./www/luci-static/resources/view/', './www/luci-static/resources/view/qwdtt/' ];

	const dataEntries = [];
	for (const d of dataDirs)
		dataEntries.push({ name: d, type: 'dir', mode: 0o755, data: '' });
	for (const k of Object.keys(files))
		dataEntries.push({ name: './' + k, type: 'file', mode: 0o644, data: files[k] });

	const controlEntries = [
		{ name: './', type: 'dir', mode: 0o755, data: '' },
		{ name: './control', type: 'file', mode: 0o644, data: controlText },
		{ name: './postinst', type: 'file', mode: 0o755, data: postinst },
		{ name: './prerm', type: 'file', mode: 0o755, data: prerm }
	];

	const dataTarGz = zlib.gzipSync(tarBytes(dataEntries));
	const controlTarGz = zlib.gzipSync(tarBytes(controlEntries));

	const outer = tarBytes([
		{ name: './debian-binary', type: 'file', mode: 0o644, data: '2.0\n' },
		{ name: './data.tar.gz', type: 'file', mode: 0o644, data: dataTarGz },
		{ name: './control.tar.gz', type: 'file', mode: 0o644, data: controlTarGz }
	]);

	fs.writeFileSync(OUT, zlib.gzipSync(outer));
	console.log('ipk written: ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
}

if (require.main === module)
	buildIpk();

module.exports = { sfh_hash, canonKey, hashKey, parsePo, buildLmo };
#!/usr/bin/env node
/*
 * mock-render.js - render the ZN515XG-D overview blocks to a standalone HTML
 * preview, *without* flashing anything.
 *
 * It loads the real, unmodified modules straight out of the package copy in
 * ./pkg/ with the LuCI globals stubbed, feeds the 硬件监控 block the sensor
 * values captured from the live device on 2026-09-27 and the 内存与储存 block a
 * representative set of values, walks the returned element trees and
 * serialises them to HTML.  Because the trees come from the very same code the
 * apk ships, preview.html is not a hand-drawn mock-up - it is what the page
 * renders, minus the browser.
 *
 *   node mock-render.js            -> rewrites the preview next to this script
 *
 * The module directory and the output path are both auto-detected, so the very
 * same file runs in either layout:
 *
 *   package repository   ./files/                      -> ./docs/preview.html
 *   working archive      ./pkg/luci-app-zn515xg-hw/files -> ./preview.html
 *
 * Re-run it after editing any module in files/ - the preview is generated, never
 * hand-edited, so a change to a module without re-running this is a lie.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const HERE = __dirname;

/* Two layouts, same script (see the header).  Probe by looking for a module we
 * cannot live without, so a wrong guess fails loudly instead of silently
 * rendering an empty page. */
function pickModulesDir() {
	const cands = [
		path.join(HERE, 'files'),                              /* package repo   */
		path.join(HERE, 'pkg', 'luci-app-zn515xg-hw', 'files') /* work archive   */
	];
	const hit = cands.find((d) => fs.existsSync(path.join(d, '15_hw.js')));
	if (!hit) {
		console.error('mock-render: 找不到模块目录（要含 15_hw.js），试过：\n  ' +
			cands.join('\n  '));
		process.exit(2);
	}
	return { dir: hit, rel: path.relative(HERE, hit) || '.' };
}
const MODS = pickModulesDir();
const BASE = MODS.dir;
/* the repo keeps the generated page under docs/; the archive keeps it up front */
const OUT_DIR = fs.existsSync(path.join(HERE, 'docs')) ? path.join(HERE, 'docs') : HERE;
const HW_SRC       = path.join(BASE, 'hardware_status.js');
const SYS_SRC      = path.join(BASE, '15_hw.js');
const MEMSTORE_SRC = path.join(BASE, '22_memstore.js');

/* ------------------------------------------------------------------ *
 * values captured from the device (192.168.1.1, PonWrt r41435,
 * 2026-09-27 ~08:00 - optical uplink up, PPE attached)
 * ------------------------------------------------------------------ */
const FILES = {
	'/sys/class/thermal/thermal_zone0/temp': '80500\n',
	'/sys/class/hwmon/hwmon0/name':          'mt7915_phy0\n',
	'/sys/class/hwmon/hwmon0/temp1_input':   '71000\n',
	'/sys/class/hwmon/hwmon1/name':          'mt7915_phy1\n',
	'/sys/class/hwmon/hwmon1/temp1_input':   '69000\n',
	'/sys/kernel/debug/ppe/config':
		'npu_attached: 1\ngdm2_fwd_cfg: 07f18888\nfe_wan_port: 00000002\n' +
		'fe_vip_port_en: ffffff0e\nfe_ifc_port_en: fffffe0e\n' +
		'ppe0_flow_cfg: 06b9b300\nppe0_table_cfg: 83c0cfb4\n' +
		'ppe0_gdm2_default_cpu_port: 5\n' +
		'ppe1_flow_cfg: 06b9b300\nppe1_table_cfg: 8bc0cfb4\n' +
		'ppe1_gdm2_default_cpu_port: 5\n',
	'/proc/stat': 'cpu  8268 0 24565 688715 92 0 29583 0 0 0\n'
};

/* taken 500 ms later, for the first-poll double sample */
const STAT2 = 'cpu  8310 0 24641 690715 92 0 29690 0 0 0\n';

/* The uplink counters are absolute, so the rate comes out of a delta between
 * two samples and the clock has to move by exactly as much as the counters do -
 * otherwise the preview would show a number that depends on how fast the
 * machine running this script happens to be.  Each helper call therefore
 * advances the fake clock by 500 ms and the counters by the real 500 ms worth
 * of traffic, which reproduces the live reading exactly:
 *   rx 202969 B / tx 4267276 B per 500 ms  ->  3.10 / 65.11 Mibit/s
 */
const PON = { rx: 2870515021, tx: 13758212093, step_rx: 202969, step_tx: 4267276 };

/* The clock is *pinned*, not merely frozen per run.  15_hw.js' info panel
 * renders `new Date(unixtime * 1000)` out of data[6], so seeding this from
 * Date.now() made every run produce a different preview.html - which means the
 * copy committed under docs/ could never be checked by re-running this script.
 * 1790702059 = 2026-09-30 01:14:19 GMT+8, the capture time of the readings. */
const FROZEN_NOW = 1790702059000;
let fakeNow = FROZEN_NOW;
let execCalls = 0;

Date.now = () => fakeNow;

const BOARDINFO = {
	hostname: 'ponwrt',
	model: 'ZNXT ZN515XG-D',
	system: 'ARMv8 Processor rev 4',
	kernel: '6.18.52',
	release: { target: 'airoha/an7581', description: 'PonWrt SNAPSHOT r41435-7cf7bd0e2a' }
};
const CPUINFO_RAW = 'ARMv8 Processor rev 4 (v8l) x 4 (900MHz, 80.7\u00b0C)';

/* ------------------------------------------------------------------ *
 * LuCI global stubs
 * ------------------------------------------------------------------ */
let statCalls = 0;

global.fs = {
	trimmed(p) {
		if (p === '/proc/stat')
			return Promise.resolve(((++statCalls % 2) ? FILES[p] : STAT2).trim());
		return Promise.resolve(FILES[p] !== undefined ? FILES[p].trim() : '');
	},
	exec() {
		execCalls++;
		fakeNow += 500;
		return Promise.resolve({
			code: 0,
			stdout: 'tcp_total=346\ntcp_npu=28\nudp_total=9147\nudp_npu=1609\n' +
				'pon_rx_bytes=' + (PON.rx + execCalls * PON.step_rx) + '\n' +
				'pon_tx_bytes=' + (PON.tx + execCalls * PON.step_tx) + '\n'
		});
	}
};

global.L = {
	resolveDefault: (p, d) => Promise.resolve(p).catch(() => d),
	isObject: (v) => v != null && typeof v === 'object',
	env: { pollinterval: 5 }
};

global._ = (s) => s;

/* plain tree instead of a real DOM */
global.E = function E(tag, attrs, children) {
	const node = { tag, attrs: attrs || {}, children: [] };
	const list = (children == null) ? [] : (Array.isArray(children) ? children : [children]);
	for (const c of list) if (c != null) node.children.push(c);
	node.appendChild = (c) => { node.children.push(c); return c; };
	return node;
};

global.baseclass = { extend: (o) => o };
/* rpcd replies consumed by the 内存与储存 block (22_memstore.js).  The 硬件监控
 * block never goes through rpc in this harness - its values are handed straight
 * to render() - so these are only used by 22_memstore.js' own load().
 *
 * These are LIVE readings captured from the real device (192.168.1.1, PonWrt
 * r41435, 2026-09-30 01:1x, uptime 74102 s) - not representative numbers.  RAM
 * is 422 MiB, the overlay is /dev/ubi0_5 (159 MiB), there is no swap and no
 * extroot.  The mount list is the device's complete reply on purpose: every
 * mount is in MountSkipList ('/rom', '/tmp', '/dev', '/overlay', '/'), so the
 * only mount row that can still surface is /tmp/.ujail - the preview shows the
 * filter doing its job instead of hiding it. */
const RPC_DATA = {
	'system.info': {
		memory: {
			total: 442609664,
			free: 42459136,
			shared: 2568192,
			buffered: 45056,
			available: 75595776,
			cached: 76865536
		},
		swap: { total: 0, free: 0 },
		root: { total: 162968, free: 133940, used: 29028, avail: 129100 },
		tmp:  { total: 216116, free: 213608, used: 2508,  avail: 213608 }
	},
	'luci.getMountPoints': [
		{ device: '/dev/root',            mount: '/rom',          size: 59506688,   avail: 0,         free: 0 },
		{ device: 'tmpfs',                mount: '/tmp',          size: 221302784,  avail: 218734592, free: 218734592 },
		{ device: 'tmpfs',                mount: '/tmp/.ujail',   size: 4096,       avail: 4096,      free: 4096 },
		{ device: '/dev/ubi0_5',          mount: '/overlay',      size: 166879232,  avail: 132198400, free: 137154560 },
		{ device: 'overlayfs:/overlay',   mount: '/',             size: 166879232,  avail: 132198400, free: 137154560 },
		{ device: 'tmpfs',                mount: '/dev',          size: 524288,     avail: 524288,    free: 524288 }
	]
};

global.rpc = {
	declare: (spec) => {
		const key = (spec && spec.object) + '.' + (spec && spec.method);
		return () => Promise.resolve(RPC_DATA[key] !== undefined ? RPC_DATA[key] : {});
	}
};
global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
global.uci = {
	load: () => Promise.resolve(),
	get: (s, x, o) => (o === 'zonename' ? 'Asia/Shanghai' : 0)
};

/* enough of String.prototype.format for the two upstream call sites
 * ('%t' uptime / '%.2f' load) */
String.prototype.format = function () {
	const args = Array.prototype.slice.call(arguments);
	let i = 0;
	return String(this).replace(/%[0-9.]*([sdifut])/g, (m, t) => {
		const v = args[i++];
		if (t === 'f') {
			const prec = (m.match(/\.(\d+)/) || [])[1];
			return Number(v || 0).toFixed(prec !== undefined ? Number(prec) : 0);
		}
		if (t === 't') {
			let s = Number(v || 0), mm = Math.floor(s / 60); s %= 60;
			let h = Math.floor(mm / 60); mm %= 60;
			const d = Math.floor(h / 24); h %= 24;
			return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + (mm ? mm + 'm ' : '') + s + 's';
		}
		return String(v);
	});
};

function loadModule(file) {
	const src = fs.readFileSync(file, 'utf8')
		.replace(/^'require [a-z_.]+';$/gm, '')
		.replace(/^'use strict';$/gm, '');
	return new Function(src)();
}

/* ------------------------------------------------------------------ *
 * serialise the element tree to HTML
 * ------------------------------------------------------------------ */
function esc(s) {
	return String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function html(node) {
	if (node == null) return '';
	if (typeof node === 'string' || typeof node === 'number') return esc(node);
	let attrs = '';
	for (const k in node.attrs)
		if (node.attrs[k] != null) attrs += ' ' + k + '="' + esc(node.attrs[k]) + '"';
	return '<' + node.tag + attrs + '>' +
		(node.children || []).map(html).join('') +
		'</' + node.tag + '>';
}

/* ------------------------------------------------------------------ */
(async () => {
	const hw  = loadModule(HW_SRC);
	const sys = loadModule(SYS_SRC);
	const mem = loadModule(MEMSTORE_SRC);

	const hwdata = await hw.read();
	const now = Math.floor(Date.now() / 1000);

	const data = [
		BOARDINFO,
		{ uptime: 766, load: [655, 402, 260] },
		{ cpubench: '' },
		{ cpuinfo: CPUINFO_RAW },
		{ cpuusage: '3%' },
		{ branch: 'LuCI', revision: 'git-26.261.08411' },
		now,
		null,
		hwdata
	];

	const hwTree = await sys.render(data);

	/* the merged memory/storage block runs through its real load() as well, so
	 * the rpc stub above is exercised the same way the browser would */
	const memTree = await mem.render(await mem.load());

	const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZN515XG-D 状态总览 - 预览</title>
<style>
/* Values copied verbatim from luci-theme-bootstrap cascade.css (light mode) */
:root {
	--background-color-high: hsl(0, 0%, 100%);
	--background-color-medium: hsl(0, 0%, 97.65%);
	--background-color-low: hsl(0, 0%, 96.08%);
	--text-color-highest: hsl(0, 0%, 0%);
	--text-color-high: hsl(0, 0%, 25.1%);
	--text-color-medium: hsl(0, 0%, 50.2%);
	--text-color-low: hsl(0, 0%, 74.9%);
	--border-color-high: hsl(0, 0%, 80%);
	--border-color-medium: hsl(0, 0%, 86.67%);
	--border-color-low: hsl(0, 0%, 93.33%);
	--primary-color-high: #1976d2;
	--error-color-high: rgb(246, 43, 18);
	--success-color-high: rgb(0, 172, 89);
	--warn-color-high: #efbd0b;
	--font-sans: Helvetica Neue, Helvetica, Arial, ui-sans-serif, system-ui, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
	background: var(--background-color-low);
	color: var(--text-color-high);
	font-family: var(--font-sans);
	font-size: 13px;
	line-height: 1.5;
	padding: 24px 16px 48px;
}
/* Fixed 1080 px canvas - the width of the device screenshot this preview is
 * checked against.  With a max-width the page would collapse its two-column
 * rows into stacked ones whenever the preview pane is narrow, which would hide
 * exactly the alignment being reviewed here. */
.wrap, .note, .footer { width: 1080px; margin: 0 auto; }
.note { margin-bottom: 16px; padding: 10px 12px;
	background: #fff8e1; border: 1px solid #ffe082; border-radius: 6px;
	color: #6d4c00; font-size: 12px;
}
.cbi-section {
	background: var(--background-color-high);
	border: 1px solid var(--border-color-low);
	border-radius: 4px;
	margin-bottom: 20px;
}
.cbi-title { padding: 10px 14px; border-bottom: 1px solid var(--border-color-low); }
.cbi-title h3 { font-size: 15px; font-weight: 600; color: var(--text-color-high); }
.cbi-section-node { padding: 14px; }
.footer { color: var(--text-color-low); font-size: 11px; }
</style>
</head>
<body>
<div class="note">
本页是<b>静态预览</b>：由 <code>mock-render.js</code> 直接执行
<code>${MODS.rel}/</code> 里的真实模块后序列化而成 —— 不是手画的示意图。
颜色取自 <code>luci-theme-bootstrap</code> 的浅色变量。<br>
「硬件监控」喂的是 2026-09-27 的设备实测值；「内存与储存」喂的是 <b>2026-09-30 从 192.168.1.1 实抓的 <code>system.info</code> / <code>luci.getMountPoints</code> 原始回报</b>（装 r2 之后抓的）。<br>
本页固定 <b>1080 px</b> 宽（与你那张设备截图同宽），否则预览面板一窄，两栏就会折成上下堆叠，看不出底边对齐的效果。
</div>
<div class="wrap">
  <div class="cbi-section">
    <div class="cbi-title"><h3>硬件监控</h3></div>
    <div class="cbi-section-node">
${html(hwTree).replace(/^\n+/, '')}
    </div>
  </div>
  <div class="cbi-section">
    <div class="cbi-title"><h3>内存与储存</h3></div>
    <div class="cbi-section-node">
${html(memTree).replace(/^\n+/, '')}
    </div>
  </div>
</div>
<div class="footer">
硬件状态数据源：thermal_zone0 / hwmon0(mt7915_phy0) 两路温度、/proc/stat 差分、
515xg-connstat（连接数 + 光口字节计数）、ppe config npu_attached、luci getCPUInfo 里的实时主频。
采样窗口 5 秒（L.env.pollinterval）；速率由两次采样的字节差分算出，单位 Mibit/s。<br>
内存与储存数据源：system.info 的 memory/swap/root/tmp + luci.getMountPoints；
跳过 /rom /tmp /dev /overlay / —— 与 stock 内存、储存块同一口径，只是换成了并排卡片。
</div>
</body>
</html>
`;

	const out = path.join(OUT_DIR, 'preview.html');
	fs.writeFileSync(out, page);
	console.log('wrote ' + out + '  (' + Buffer.byteLength(page) + ' B)');
	console.log('hwdata: ' + JSON.stringify(hwdata));
})();

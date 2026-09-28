// dev-edit.mjs — 行编辑备胎（编辑服务不可用时的终端编辑通道）
// node scripts/dev-edit.mjs <cmd> <file> [args]
//   head <file> [n] | sed <file> <a> <b> | del <file> <a> <b>
//   ins <file> <n> <line...> | put <file> <line...> | app <file> <line...> | rep <file> <n> <line...>
import fs from 'node:fs';
const [, , cmd, file, ...args] = process.argv;
const read = () => fs.readFileSync(file, 'utf8');
const lines = () => read().split(String.fromCharCode(10));
const save = (xs) => fs.writeFileSync(file, xs.join(String.fromCharCode(10)));
const NLCH = String.fromCharCode(10);
const pad = (n) => String(n).padStart(4);
switch (cmd) {
  case 'head': {
    const xs = lines().slice(0, Number(args[0] ?? 40));
    console.log(xs.map((l, i) => pad(i + 1) + ' | ' + l).join(NLCH));
    break;
  }
  case 'sed': {
    const [a, b] = args.map(Number);
    console.log(lines().slice(a - 1, b).map((l, i) => pad(a + i) + ' | ' + l).join(NLCH));
    break;
  }
  case 'del': {
    const [a, b] = args.map(Number);
    const xs = lines();
    xs.splice(a - 1, b - a + 1);
    save(xs);
    console.log('deleted', a, b);
    break;
  }
  case 'ins': {
    const [at, ...content] = args;
    const xs = lines();
    xs.splice(Number(at), 0, ...content);
    save(xs);
    console.log('inserted', content.length, 'at', at);
    break;
  }
  case 'put': {
    fs.writeFileSync(file, args.join(NLCH) + NLCH);
    console.log('wrote', args.length, 'lines');
    break;
  }
  case 'app': {
    fs.appendFileSync(file, args.join(NLCH) + NLCH);
    console.log('appended', args.length, 'lines');
    break;
  }
  case 'rep': {
    const [at, ...content] = args;
    const xs = lines();
    xs.splice(Number(at) - 1, content.length, ...content);
    save(xs);
    console.log('replaced', content.length, 'from', at);
    break;
  }
  default:
    console.error('unknown cmd: ' + cmd);
    process.exit(1);
}
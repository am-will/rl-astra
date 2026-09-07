import { build } from 'esbuild';
import { simulationBuild } from './build-id.mjs';
await build({ entryPoints: ['server/index.ts', 'server/room.ts', 'server/benchmark.ts'], outdir: 'dist-server', outExtension: { '.js': '.mjs' }, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external', sourcemap: true, define: { __SIM_BUILD__: JSON.stringify(simulationBuild()) } });

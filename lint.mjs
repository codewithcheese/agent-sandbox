import { execSync } from 'node:child_process';

if (process.env.CI === 'true') {
  execSync('pnpm exec eslint . --ext .js,.ts,.svelte', {
    stdio: 'inherit'
  });
} else {
  console.log('Skipping ESLint because CI is not set to true');
}

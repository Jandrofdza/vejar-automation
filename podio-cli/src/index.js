import { Command } from 'commander';
import { cfg } from './config.js';
import { appAuth, getItem, getItemFiles, getFileMeta, downloadFromLink } from './podio.js';
import { supaClient, uploadBuffer, makeKey, ensureContentType } from './supabase.js';
import { runOnce, ensureAccessToken } from './run.js';

const program = new Command();

program
  .name('podio-cli')
  .description('Podio → Supabase → GPT → Podio pipeline');

program
  .command('auth')
  .description('Obtain a Podio app access token')
  .action(async () => {
    const json = await appAuth({
      clientId: cfg.podio.clientId,
      clientSecret: cfg.podio.clientSecret,
      appId: cfg.podio.appId,
      appToken: cfg.podio.appToken,
    });
    console.log(JSON.stringify(json, null, 2));
  });

program
  .command('files')
  .description('List item files and show first file meta/link')
  .argument('<itemId>', 'Podio item id', (v) => Number(v))
  .action(async (itemId) => {
    const token = await ensureAccessToken();
    const item = await getItem(itemId, token);
    const files = getItemFiles(item);
    console.log('file_count:', item.file_count, 'files[] length:', files.length);
    if (files[0]) {
      const meta = await getFileMeta(files[0].file_id, token);
      console.log('first file meta:', meta);
    }
  });

program
  .command('run')
  .description('Process one item end-to-end')
  .argument('<itemId>', 'Podio item id', (v) => Number(v))
  .action(async (itemId) => {
    await runOnce(itemId);
  });

program.parseAsync(process.argv);

import { createLocalProxy, LOCAL_PROXY_HOST, LOCAL_PROXY_PORT } from './local-proxy';

try {
  const server = createLocalProxy(process.env);
  server.once('error', () => {
    console.error(`Could not start the local proxy at http://${LOCAL_PROXY_HOST}:${LOCAL_PROXY_PORT}. Check that the port is free.`);
    process.exitCode = 1;
  });
  server.listen(LOCAL_PROXY_PORT, LOCAL_PROXY_HOST, () => {
    const label = process.env.N2YO_API_KEY?.trim() ? 'Local provider' : 'Space-Track';
    console.log(`${label} proxy listening at http://${LOCAL_PROXY_HOST}:${LOCAL_PROXY_PORT}`);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not configure the local proxy.');
  process.exitCode = 1;
}

import { createRestServer, serveStdio } from './demo.js';

if (process.argv[2] === 'rest') void createRestServer().then(server => server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1'));
else void serveStdio();

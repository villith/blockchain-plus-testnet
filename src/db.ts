import * as minimist from 'minimist';
import * as mongoose from 'mongoose';

const argv = minimist(process.argv.slice(2));
const conn = mongoose.createConnection(`mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_IP}:27017/${process.env.DB_NAME}`);

conn.on('open', () => {
  /** If this instance was started by TravisCI, exit process. Current CI is not properly implemented yet */
  if (argv.ci === 'true') {
    process.exit();
  }
});

conn.on('error', (err) => {
  console.log('ERROR');
  console.log(err);
});

export { conn };

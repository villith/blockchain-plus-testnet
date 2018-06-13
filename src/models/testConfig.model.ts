import * as mongoose from 'mongoose';

const TestConfigSchema = new mongoose.Schema({
  testId: String,
  duration: Number,
  numSenders: Number,
  local: Boolean,
  maxLedgerLength: Number,
  sendersAsValidators: Boolean,
});

export { TestConfigSchema };

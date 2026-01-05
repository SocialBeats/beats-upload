import { connect } from 'space-node-client';

export const spaceClient = connect({
  url: process.env.SPACE_URL || 'http://localhost:5403/',
  apiKey: process.env.SPACE_API_KEY,
});

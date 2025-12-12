import 'dotenv/config';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { BeatService } from '../src/services/beatService.js';
import { connectDB, disconnectDB } from '../src/db.js';

const runTest = async () => {
  console.log('🚀 Starting E2E S3 Flow Test...');

  // 1. Validate Env
  const requiredEnv = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_BUCKET_NAME',
  ];
  const missingEnv = requiredEnv.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    console.error(`❌ Missing environment variables: ${missingEnv.join(', ')}`);
    process.exit(1);
  }

  // 2. Connect to DB
  await connectDB();

  // 3. Init S3
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const bucketName = process.env.AWS_BUCKET_NAME;
  const testKey = `test-beats/e2e-test-${Date.now()}.mp3`;
  const testBody = 'This is a dummy MP3 file content for testing purposes.';

  try {
    // 4. Simulate Frontend Upload
    console.log(`\n📤 Uploading dummy file to S3: ${testKey}...`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: testKey,
        Body: testBody,
        ContentType: 'audio/mpeg',
      })
    );
    console.log('✅ File uploaded to S3.');

    // 5. Create Beat in DB
    console.log('\n💾 Creating Beat in Database...');
    const beatData = {
      title: 'E2E Test Beat',

      genre: 'Other',
      audio: {
        s3Key: testKey,
        filename: 'e2e-test.mp3',
        size: Buffer.byteLength(testBody),
        format: 'mp3',
      },
    };

    const createdBeat = await BeatService.createBeat(beatData);
    console.log(`✅ Beat created with ID: ${createdBeat._id}`);
    console.log(`   Audio URL (Virtual): ${createdBeat.audioUrl}`);

    // 6. Verify S3 File Exists (sanity check)
    console.log('\n🔍 Verifying S3 file existence...');
    await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: testKey,
      })
    );
    console.log('✅ S3 file confirmed exists.');

    // 7. Delete Beat (Should trigger S3 deletion)
    console.log(`\n🗑️ Deleting Beat ${createdBeat._id}...`);
    const deleted = await BeatService.deleteBeatPermanently(createdBeat._id);
    if (!deleted) throw new Error('Failed to delete beat');
    console.log('✅ Beat deleted from DB.');

    // 8. Verify S3 File Deletion
    console.log('\n🔍 Verifying S3 file deletion...');
    try {
      await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: testKey,
        })
      );
      throw new Error('❌ S3 file still exists after deletion!');
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        console.log('✅ S3 file confirmed deleted (NoSuchKey).');
      } else {
        throw error;
      }
    }

    console.log('\n✨ E2E Test Completed Successfully!');
  } catch (error) {
    if (
      error.Code === 'PermanentRedirect' ||
      error.name === 'PermanentRedirect'
    ) {
      console.error('\n❌ Region Mismatch Error:');
      console.error(
        `   The bucket '${bucketName}' is in a different region than configured.`
      );
      console.error(`   Your .env has AWS_REGION=${process.env.AWS_REGION}`);
      console.error(
        `   Please change it to the region specified in the error endpoint (likely '${error.Endpoint?.split('.')[2]}' or similar).`
      );
    } else {
      console.error('\n❌ Test Failed:', error);
    }
  } finally {
    await disconnectDB();
  }
};

runTest();

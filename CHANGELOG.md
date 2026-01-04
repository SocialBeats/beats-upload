# Release v2.1.1

## Features
No new features.
## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: normalize resourceKey to avoid double slash in CloudFront URLs

## Continuous integration (CI)
No CI changes.
## Other changes
- Merge pull request #23 from SocialBeats/develop

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v2.1.0...v2.1.1).

# Release v2.1.0

## Features
- feat: testing suit updated for bottleneck and toobusy libraries
- feat: bottleneck and too-busy integration
- feat: kafka integration with analytics

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
No fixes added.
## Continuous integration (CI)
No CI changes.
## Other changes
- Merge pull request #22 from SocialBeats/develop

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v2.0.0...v2.1.0).

# Release v2.0.0

## Features
- feat: add new test cases for presigned url cdn
- feat: new presigned access to cdn
- feat: new test cases added for kafka and waveform generation
- feat: sync OAS with new upload endpoint signature
- feat: test cases updated to new presigned urls uploading method
- feat: enhance beats upload by using presigned urls

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: kafka integration
- fix: correct DeleteObjectCommand specific call

## Continuous integration (CI)
No CI changes.
## Other changes
- chore: update CHANGELOG and .version for v1.1.0
- Merge pull request #21 from SocialBeats/develop
- Merge pull request #20 from SocialBeats/s3-rate-limit
- Merge branch 'develop' into s3-rate-limit

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v1.1.0...v2.0.0).

# Release v1.1.0

## Features
- feat: new test cases added for kafka and waveform generation

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: kafka integration

## Continuous integration (CI)
No CI changes.
## Other changes
- chore: update CHANGELOG and .version for v1.1.0
- Merge pull request #19 from SocialBeats/develop

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v1.0.0...v1.1.0).

# Release v1.1.0

## Features
- feat: new test cases added for kafka and waveform generation

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: kafka integration

## Continuous integration (CI)
No CI changes.
## Other changes
- Merge pull request #19 from SocialBeats/develop

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v1.0.0...v1.1.0).

# Release v1.0.0

## Features
- feat: added features to sync with dashboard microservice via kafka
- feat: removed key attribute from beat model
- feat: beat download and cover integration
- feat: added kafka configuration
- feat: microservice template missing docker features added

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: added vitest config for new testing suite
- fix: modify docker-compose.yml mongodb datbabase container name
- fix: fixed serch beat by username
- fix: set beat user username from api gateway headers
- fix: remove pricing atributes from Beat model

## Continuous integration (CI)
No CI changes.
## Other changes
- Merge pull request #18 from SocialBeats/develop
- Merge pull request #17 from SocialBeats/beats-download

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/v0.0.1...v1.0.0).

# Release v0.0.1

## Features
- feat: added validation to file format avoiding invalid format tricks
- feat: s3 integration
- feat: get Logged user beats enpoint added and tests
- feat: validations and middlewares added for Beat API methods
- feat: first test suite for beat upload
- feat: generate a presigned url in order to upload s3 files
- feat: CRUD of Beat entity
- feat: Beat entity initial version

## Tests
No test changes.
## Documentation
No documentation changes.
## Fixes
- fix: beatService.tests fixed
- fix: last copilot changes accepted
- fix: copilot changes suggested applied
- fix: run-test.yml actualized to get env secrets from GitHub secrets
- fix: docker-compose.yml actualized to run microsrevice integrated in hole aplication
- fix: removed bpm and duration from Beat entity
- fix: tests updated for vaidations changes
- fix: fixed swagger routes to allow deployment documentation
- fix: remove atributes status and updatedAt from Beat entity
- fix: changed node local version to adjust workflows node version

## Continuous integration (CI)
No CI changes.
## Other changes
- Merge pull request #10 from SocialBeats/develop
- Merge pull request #7 from SocialBeats/feat/beats-entity
- Merge branch 'develop' into feat/beats-entity
- Merge pull request #6 from SocialBeats/develop
- Merge pull request #5 from SocialBeats/feat/beats-entity
- chore: adaptacion de template a microservicio de beats upload
- Initial commit

## Full commit history

For full commit history, see [here](https://github.com/SocialBeats/beats-upload/compare/...v0.0.1).


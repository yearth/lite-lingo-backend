import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let ttsServiceMock: { synthesizeSpeech: jest.Mock }; // Define mock type

  beforeEach(async () => {
    // Import necessary modules here
    const { TtsService } = await import('./../src/tts/tts.service');
    const { Readable } = await import('stream');

    // Create a mock object for TtsService
    ttsServiceMock = {
      synthesizeSpeech: jest.fn().mockResolvedValue(
        // Return a readable stream with dummy data
        Readable.from(Buffer.from('dummy audio data')),
      ),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Override the real TtsService with the mock
      .overrideProvider(TtsService)
      .useValue(ttsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();

    // Apply ValidationPipe to the test application instance
    const { ValidationPipe } = await import('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  // Test suite for TTS endpoint
  describe('/tts (POST)', () => {
    it('should return an audio stream for valid input', async () => {
      const requestBody = { text: 'Test speech synthesis' };

      const response = await request(app.getHttpServer())
        .post('/tts')
        .send(requestBody)
        .expect(200) // Expect HTTP 200 OK
        .expect('Content-Type', /audio\/mpeg/); // Expect correct Content-Type

      // Check if the mock function was called with the correct text
      expect(ttsServiceMock.synthesizeSpeech).toHaveBeenCalledWith(
        requestBody.text,
        undefined, // Voice was not provided in this test case
      );

      // Check if the response body is not empty (contains dummy audio data)
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body.toString()).toEqual('dummy audio data');
    });

    it('should return 400 for missing text field', () => {
      return request(app.getHttpServer())
        .post('/tts')
        .send({}) // Send empty body
        .expect(400); // Expect HTTP 400 Bad Request
    });

    it('should handle service errors (mocked)', async () => {
      // Configure the mock to throw an error for this test
      ttsServiceMock.synthesizeSpeech.mockRejectedValueOnce(
        new Error('Mock TTS Service Error'),
      );

      const requestBody = { text: 'This will cause an error' };

      await request(app.getHttpServer())
        .post('/tts')
        .send(requestBody)
        .expect(500); // Expect HTTP 500 Internal Server Error
    });
  });
});

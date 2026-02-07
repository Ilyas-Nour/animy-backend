import { Test, TestingModule } from '@nestjs/testing';
import { NewsEngagementController } from './news-engagement.controller';

describe('NewsEngagementController', () => {
  let controller: NewsEngagementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NewsEngagementController],
    }).compile();

    controller = module.get<NewsEngagementController>(NewsEngagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

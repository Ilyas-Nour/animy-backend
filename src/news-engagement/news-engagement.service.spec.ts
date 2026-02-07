import { Test, TestingModule } from '@nestjs/testing';
import { NewsEngagementService } from './news-engagement.service';

describe('NewsEngagementService', () => {
  let service: NewsEngagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NewsEngagementService],
    }).compile();

    service = module.get<NewsEngagementService>(NewsEngagementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

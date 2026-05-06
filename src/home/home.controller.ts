import { Controller, Get } from "@nestjs/common";
import { HomeService } from "./home.service";
import { Public } from "../common/decorators/public.decorator";

@Controller("home")
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Public()
  @Get()
  async getHomeData() {
    return this.homeService.getHomeData();
  }
}

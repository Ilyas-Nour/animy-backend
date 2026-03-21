import { Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn(
        "Supabase credentials not configured. File uploads will fail.",
      );
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async uploadFile(
    bucket: "avatars" | "banners",
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<string | null> {
    if (!this.supabase) {
      console.error("Supabase client not initialized");
      return null;
    }

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(filename, buffer, {
        contentType,
        upsert: true, // Overwrite if exists
      });

    if (error) {
      console.error(`Supabase upload error:`, error);
      return null;
    }

    // Get public URL
    const { data: urlData } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(filename);

    return urlData.publicUrl;
  }

  async deleteFile(
    bucket: "avatars" | "banners",
    path: string,
  ): Promise<boolean> {
    if (!this.supabase) return false;

    // Extract just the filename from the full URL if needed
    const filename = path.includes("/") ? path.split("/").pop() : path;

    const { error } = await this.supabase.storage
      .from(bucket)
      .remove([filename]);

    if (error) {
      console.error(`Supabase delete error:`, error);
      return false;
    }

    return true;
  }
}

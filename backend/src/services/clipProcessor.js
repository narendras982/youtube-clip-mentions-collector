const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ClipProcessor {
  constructor() {
    this.outputDir = process.env.CLIPS_OUTPUT_DIR || path.join(__dirname, '../../clips');
    this.tempDir = process.env.CLIPS_TEMP_DIR || path.join(__dirname, '../../temp');
    this.maxConcurrent = parseInt(process.env.CLIP_MAX_CONCURRENT) || 3;
    this.activeJobs = new Map();
    
    // Ensure directories exist
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
      logger.info('Clip processor directories initialized', {
        outputDir: this.outputDir,
        tempDir: this.tempDir
      });
    } catch (error) {
      logger.error('Error creating clip processor directories', error);
    }
  }

  /**
   * Generate clip from mention data
   */
  async generateClip(clip, clipSettings = {}) {
    const clipId = clip._id.toString();
    
    if (this.activeJobs.has(clipId)) {
      throw new Error('Clip generation already in progress');
    }

    try {
      // Mark clip as processing
      await clip.startProcessing();
      this.activeJobs.set(clipId, { startTime: Date.now(), clip });

      logger.info('Starting clip generation', {
        clipId: clipId,
        videoId: clip.source_video_id,
        startTime: clip.start_time,
        endTime: clip.end_time,
        format: clip.format
      });

      // Step 1: Download source video segment
      const tempVideoPath = await this.downloadVideoSegment(clip);
      await clip.updateProgress(30);

      // Step 2: Process video (trim, format conversion, etc.)
      const processedVideoPath = await this.processVideoSegment(clip, tempVideoPath);
      await clip.updateProgress(60);

      // Step 3: Add subtitles if requested
      if (clip.generation_settings.include_subtitles) {
        await this.addSubtitles(clip, processedVideoPath);
        await clip.updateProgress(80);
      }

      // Step 4: Add watermark if requested
      if (clip.generation_settings.watermark) {
        await this.addWatermark(clip, processedVideoPath);
        await clip.updateProgress(90);
      }

      // Step 5: Move to final location
      const finalPath = await this.moveToFinalLocation(clip, processedVideoPath);
      const fileSize = (await fs.stat(finalPath)).size;

      // Complete processing
      await clip.completeProcessing(finalPath, fileSize);
      await clip.updateProgress(100);

      // Clean up temp files
      await this.cleanupTempFiles([tempVideoPath, processedVideoPath]);

      logger.info('Clip generation completed successfully', {
        clipId: clipId,
        finalPath: finalPath,
        fileSize: fileSize,
        duration: Date.now() - this.activeJobs.get(clipId).startTime
      });

      return {
        status: 'completed',
        file_path: finalPath,
        file_size: fileSize,
        processing_time: Date.now() - this.activeJobs.get(clipId).startTime
      };

    } catch (error) {
      logger.error('Error generating clip', {
        clipId: clipId,
        error: error.message,
        stack: error.stack
      });

      // Mark clip as error
      await clip.completeProcessing(null, 0, error.message);

      throw error;
    } finally {
      this.activeJobs.delete(clipId);
    }
  }

  /**
   * Download video segment using yt-dlp
   */
  async downloadVideoSegment(clip) {
    const videoUrl = `https://www.youtube.com/watch?v=${clip.source_video_id}`;
    const tempFileName = `temp_${clip.clip_id}_${Date.now()}.%(ext)s`;
    const tempPath = path.join(this.tempDir, tempFileName);

    // Calculate download time range with padding
    const padding = clip.generation_settings.context_padding || 20;
    const startTime = Math.max(0, clip.start_time - padding);
    const endTime = clip.end_time + padding;

    // Build yt-dlp command
    const ytdlpArgs = [
      '--format', this.getVideoFormat(clip.quality),
      '--external-downloader', 'ffmpeg',
      '--external-downloader-args', `ffmpeg_i:-ss ${startTime} -to ${endTime}`,
      '--output', tempPath,
      '--no-playlist',
      '--no-warnings'
    ];

    // Add proxy if VPN service is available
    const VPNRotator = require('./vpnRotator');
    try {
      const vpnRotator = new VPNRotator();
      const proxyUrl = await vpnRotator.getProxy();
      if (proxyUrl) {
        ytdlpArgs.push('--proxy', proxyUrl);
      }
    } catch (vpnError) {
      logger.warn('VPN not available for clip download', { clipId: clip._id });
    }

    ytdlpArgs.push(videoUrl);

    try {
      const command = `yt-dlp ${ytdlpArgs.join(' ')}`;
      logger.debug('Executing yt-dlp command', { 
        clipId: clip._id, 
        command: command.replace(/--proxy \S+/, '--proxy [REDACTED]')
      });

      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minutes timeout
        cwd: this.tempDir
      });

      // Find the actual downloaded file
      const files = await fs.readdir(this.tempDir);
      const downloadedFile = files.find(file => 
        file.startsWith(`temp_${clip.clip_id}_`) && 
        !file.endsWith('.part')
      );

      if (!downloadedFile) {
        throw new Error('Downloaded video file not found');
      }

      const downloadedPath = path.join(this.tempDir, downloadedFile);
      logger.debug('Video segment downloaded', {
        clipId: clip._id,
        filePath: downloadedPath,
        fileSize: (await fs.stat(downloadedPath)).size
      });

      return downloadedPath;

    } catch (error) {
      logger.error('Error downloading video segment', {
        clipId: clip._id,
        videoUrl: videoUrl,
        error: error.message
      });
      throw new Error(`Video download failed: ${error.message}`);
    }
  }

  /**
   * Process video segment (trim, convert, etc.)
   */
  async processVideoSegment(clip, inputPath) {
    const outputFileName = `processed_${clip.clip_id}.${clip.format}`;
    const outputPath = path.join(this.tempDir, outputFileName);

    // Calculate precise trim times
    const padding = clip.generation_settings.context_padding || 20;
    const startTime = Math.max(0, clip.start_time - padding);
    const duration = (clip.end_time + padding) - startTime;

    let ffmpegArgs = [
      '-i', inputPath,
      '-ss', '0', // Start from beginning since we already trimmed in yt-dlp
      '-t', duration.toString(),
      '-avoid_negative_ts', 'make_zero'
    ];

    // Video/audio processing based on format
    if (clip.format === 'mp3' || clip.generation_settings.audio_only) {
      // Audio only
      ffmpegArgs.push(
        '-vn', // No video
        '-acodec', 'libmp3lame',
        '-ab', '192k',
        '-ar', '44100'
      );
    } else if (clip.format === 'mp4') {
      // Video processing
      const videoCodec = clip.codec || 'libx264';
      ffmpegArgs.push(
        '-vcodec', videoCodec,
        '-acodec', 'aac',
        '-preset', 'medium',
        '-crf', '23'
      );

      // Quality scaling
      if (clip.quality !== '1080p') {
        const scale = this.getVideoScale(clip.quality);
        if (scale) {
          ffmpegArgs.push('-vf', `scale=${scale}`);
        }
      }
    } else if (clip.format === 'webm') {
      // WebM processing
      ffmpegArgs.push(
        '-vcodec', 'libvpx-vp9',
        '-acodec', 'libvorbis',
        '-crf', '30',
        '-b:v', '0'
      );
    }

    ffmpegArgs.push(
      '-y', // Overwrite output file
      outputPath
    );

    try {
      const command = `ffmpeg ${ffmpegArgs.join(' ')}`;
      logger.debug('Processing video with FFmpeg', {
        clipId: clip._id,
        command: command
      });

      const { stdout, stderr } = await execAsync(command, {
        timeout: 600000 // 10 minutes timeout
      });

      // Verify output file exists
      const stats = await fs.stat(outputPath);
      logger.debug('Video processing completed', {
        clipId: clip._id,
        outputPath: outputPath,
        fileSize: stats.size
      });

      return outputPath;

    } catch (error) {
      logger.error('Error processing video segment', {
        clipId: clip._id,
        inputPath: inputPath,
        error: error.message
      });
      throw new Error(`Video processing failed: ${error.message}`);
    }
  }

  /**
   * Add subtitles to video
   */
  async addSubtitles(clip, videoPath) {
    if (clip.format === 'mp3' || clip.generation_settings.audio_only) {
      return; // Skip subtitles for audio-only clips
    }

    try {
      // Get transcript for the specific time range
      const Mention = require('../models/Mention');
      const mention = await Mention.findById(clip.mention_id);
      
      if (!mention || !mention.transcript_segment) {
        logger.warn('No transcript available for subtitles', { clipId: clip._id });
        return;
      }

      // Create SRT file
      const srtPath = path.join(this.tempDir, `subtitles_${clip.clip_id}.srt`);
      const srtContent = this.generateSRTContent(mention.transcript_segment, clip);
      await fs.writeFile(srtPath, srtContent);

      // Add subtitles to video
      const outputPath = path.join(this.tempDir, `subtitled_${clip.clip_id}.${clip.format}`);
      const ffmpegArgs = [
        '-i', videoPath,
        '-i', srtPath,
        '-c', 'copy',
        '-c:s', 'mov_text',
        '-map', '0',
        '-map', '1',
        '-y',
        outputPath
      ];

      const command = `ffmpeg ${ffmpegArgs.join(' ')}`;
      await execAsync(command, { timeout: 300000 });

      // Replace original video with subtitled version
      await fs.rename(outputPath, videoPath);
      await fs.unlink(srtPath);

      logger.debug('Subtitles added to clip', { clipId: clip._id });

    } catch (error) {
      logger.error('Error adding subtitles', {
        clipId: clip._id,
        error: error.message
      });
      // Non-critical error, continue without subtitles
    }
  }

  /**
   * Add watermark to video
   */
  async addWatermark(clip, videoPath) {
    if (clip.format === 'mp3' || clip.generation_settings.audio_only) {
      return; // Skip watermark for audio-only clips
    }

    try {
      const watermarkText = `${clip.mention_context.detected_keyword} - ${clip.source_metadata.channel_name}`;
      const outputPath = path.join(this.tempDir, `watermarked_${clip.clip_id}.${clip.format}`);

      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `drawtext=text='${watermarkText}':x=10:y=H-th-10:fontsize=24:fontcolor=white@0.8:box=1:boxcolor=black@0.3`,
        '-c:a', 'copy',
        '-y',
        outputPath
      ];

      const command = `ffmpeg ${ffmpegArgs.join(' ')}`;
      await execAsync(command, { timeout: 300000 });

      // Replace original video with watermarked version
      await fs.rename(outputPath, videoPath);

      logger.debug('Watermark added to clip', { clipId: clip._id });

    } catch (error) {
      logger.error('Error adding watermark', {
        clipId: clip._id,
        error: error.message
      });
      // Non-critical error, continue without watermark
    }
  }

  /**
   * Move processed video to final location
   */
  async moveToFinalLocation(clip, tempPath) {
    const finalFileName = `${clip.clip_id}.${clip.format}`;
    const finalPath = path.join(this.outputDir, finalFileName);

    await fs.rename(tempPath, finalPath);

    logger.debug('Clip moved to final location', {
      clipId: clip._id,
      finalPath: finalPath
    });

    return finalPath;
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(filePaths) {
    for (const filePath of filePaths) {
      try {
        if (filePath) {
          await fs.unlink(filePath);
        }
      } catch (error) {
        logger.warn('Could not clean up temp file', {
          filePath: filePath,
          error: error.message
        });
      }
    }
  }

  /**
   * Generate SRT subtitle content
   */
  generateSRTContent(transcriptSegment, clip) {
    const startTime = this.formatSRTTime(0); // Relative to clip start
    const endTime = this.formatSRTTime(clip.duration);
    
    return `1\n${startTime} --> ${endTime}\n${transcriptSegment.text}\n\n`;
  }

  /**
   * Format time for SRT format (HH:MM:SS,mmm)
   */
  formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  /**
   * Get video format string for yt-dlp
   */
  getVideoFormat(quality) {
    const formats = {
      '144p': 'worst[height<=144]',
      '240p': 'worst[height<=240]',
      '360p': 'best[height<=360]',
      '480p': 'best[height<=480]',
      '720p': 'best[height<=720]',
      '1080p': 'best[height<=1080]',
      'audio_only': 'bestaudio'
    };

    return formats[quality] || 'best[height<=720]';
  }

  /**
   * Get video scale for FFmpeg
   */
  getVideoScale(quality) {
    const scales = {
      '144p': '256:144',
      '240p': '426:240', 
      '360p': '640:360',
      '480p': '854:480',
      '720p': '1280:720',
      '1080p': null // No scaling needed
    };

    return scales[quality];
  }

  /**
   * Get current processing status
   */
  getStatus() {
    return {
      active_jobs: this.activeJobs.size,
      max_concurrent: this.maxConcurrent,
      output_directory: this.outputDir,
      temp_directory: this.tempDir
    };
  }

  /**
   * Generate clip from mention (static method for external use)
   */
  static async generateClipFromMention(mentionData, clipSettings = {}) {
    const clipProcessor = new ClipProcessor();
    return await clipProcessor.generateClip(mentionData, clipSettings);
  }
}

module.exports = ClipProcessor;
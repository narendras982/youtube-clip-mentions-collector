const mongoose = require('mongoose');
require('dotenv').config();

async function generateClipsFromMentions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_mentions');
    console.log('Connected to MongoDB');
    
    const Mention = require('./src/models/Mention');
    const RawVideo = require('./src/models/RawVideo');
    const Clip = require('./src/models/Clip');
    
    // Get all distinct video IDs from mentions
    const mentionVideoIds = await Mention.distinct('video_metadata.video_id');
    const rawVideoIds = await RawVideo.distinct('video_id');
    const matchingVideoIds = mentionVideoIds.filter(id => rawVideoIds.includes(id));
    
    console.log('Processing', matchingVideoIds.length, 'videos with matching mentions and raw videos');
    
    let totalClipsCreated = 0;
    let totalMentionsProcessed = 0;
    let errors = [];
    
    // Process each matching video ID
    for (const videoId of matchingVideoIds) {
      try {
        const mentions = await Mention.find({ 'video_metadata.video_id': videoId });
        const rawVideo = await RawVideo.findOne({ video_id: videoId });
        
        if (!rawVideo) {
          console.log('No raw video found for', videoId, '- skipping');
          continue;
        }
        
        console.log('\nProcessing video:', videoId);
        console.log('- Found', mentions.length, 'mentions');
        console.log('- Raw video:', rawVideo.title.substring(0, 50) + '...');
        
        for (const mention of mentions) {
          try {
            // Check if clip already exists for this mention
            const existingClip = await Clip.findOne({ mention_id: mention._id });
            if (existingClip) {
              console.log('  - Clip already exists for mention', mention.detected_keyword);
              continue;
            }
            
            const clipData = {
              title: `${mention.detected_keyword} - ${(mention.video_metadata.video_title || rawVideo.title).substring(0, 50)}`,
              description: `Mention of "${mention.detected_keyword}" in ${mention.video_metadata.channel_name || 'Unknown Channel'}`,
              source_video_id: mention.video_metadata.video_id,
              mention_id: mention._id,
              raw_video_id: rawVideo._id,
              feed_id: rawVideo.feed_id,
              start_time: mention.clip_context.start_time,
              end_time: mention.clip_context.end_time,
              duration: mention.clip_context.duration,
              format: 'mp4',
              quality: '720p',
              generation_settings: {
                context_padding: 20,
                audio_only: false,
                include_subtitles: false,
                watermark: false
              },
              source_metadata: {
                original_title: mention.video_metadata.video_title || rawVideo.title,
                channel_name: mention.video_metadata.channel_name || 'Unknown Channel',
                channel_id: mention.video_metadata.channel_id || 'unknown',
                published_at: mention.video_metadata.published_at || new Date(),
                original_url: mention.video_metadata.video_url || `https://youtube.com/watch?v=${videoId}`,
                thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
              },
              mention_context: {
                detected_keyword: mention.detected_keyword,
                confidence_score: mention.confidence_score,
                sentiment: mention.sentiment?.overall || 'neutral',
                language: mention.language,
                mention_text: mention.mention_text,
                context_before: mention.transcript_segment.text.substring(0, 100),
                context_after: mention.transcript_segment.text.substring(-100),
                related_mentions: [],
                mention_count: 1,
                avg_confidence: mention.confidence_score,
                dominant_sentiment: mention.sentiment?.overall || 'neutral'
              },
              created_by: 'system_auto',
              tags: ['auto-generated', mention.detected_keyword, mention.language]
            };
            
            const clip = new Clip(clipData);
            await clip.save();
            
            console.log('  ✓ Created clip for:', mention.detected_keyword);
            totalClipsCreated++;
            
          } catch (clipError) {
            console.log('  ✗ Error creating clip for', mention.detected_keyword, ':', clipError.message);
            errors.push({
              videoId: videoId,
              keyword: mention.detected_keyword,
              error: clipError.message
            });
          }
          
          totalMentionsProcessed++;
        }
        
      } catch (videoError) {
        console.log('Error processing video', videoId, ':', videoError.message);
        errors.push({
          videoId: videoId,
          error: videoError.message
        });
      }
    }
    
    const finalClipCount = await Clip.countDocuments();
    
    console.log('\n=== CLIP GENERATION COMPLETE ===');
    console.log('Total mentions processed:', totalMentionsProcessed);
    console.log('Total clips created:', totalClipsCreated);
    console.log('Total clips in database:', finalClipCount);
    console.log('Errors:', errors.length);
    
    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.forEach((err, i) => {
        console.log(`${i+1}. ${err.videoId} - ${err.keyword || 'video processing'}: ${err.error}`);
      });
    }
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

generateClipsFromMentions();
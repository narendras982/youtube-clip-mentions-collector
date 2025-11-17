#!/usr/bin/env node

/**
 * Update RSS Feed Keywords with Comprehensive Politician Names
 * 
 * This script adds politician names from Maharashtra and National level
 * based on the Social Media Monitoring project's keyword analysis.
 */

const mongoose = require('mongoose');
const RSSFeed = require('./src/models/RSSFeed');

// Comprehensive politician keywords (Maharashtra + National)
const POLITICIAN_KEYWORDS = {
  // **NATIONAL POLITICIANS**
  national: [
    // Prime Minister & Deputy PM
    'नरेंद्र मोदी', 'narendra modi', 'modi', 'मोदी', 'pm modi', 'प्रधानमंत्री मोदी',
    'amit shah', 'अमित शाह', 'शाह', 'home minister', 'गृहमंत्री',
    'राजनाथ सिंह', 'rajnath singh', 'defence minister', 'रक्षामंत्री',
    
    // Congress Leadership
    'rahul gandhi', 'राहुल गांधी', 'गांधी', 'congress president',
    'sonia gandhi', 'सोनिया गांधी', 'priyanka gandhi', 'प्रियंका गांधी',
    
    // Other National Leaders
    'mamata banerjee', 'ममता बनर्जी', 'west bengal cm',
    'arvind kejriwal', 'अरविंद केजरीवाल', 'aap', 'delhi cm',
    'yogi adityanath', 'योगी आदित्यनाथ', 'योगी', 'up cm', 'मुख्यमंत्री योगी'
  ],

  // **MAHARASHTRA POLITICIANS**
  maharashtra: [
    // Chief Ministers & Deputy CMs
    'eknath shinde', 'एकनाथ शिंदे', 'शिंदे', 'cm shinde', 'मुख्यमंत्री शिंदे',
    'devendra fadnavis', 'देवेंद्र फडणवीस', 'फडणवीस', 'deputy cm', 'उपमुख्यमंत्री',
    'ajit pawar', 'अजित पवार', 'deputy cm pawar', 'उपमुख्यमंत्री पवार',
    
    // Shiv Sena Leaders
    'uddhav thackeray', 'उद्धव ठाकरे', 'ठाकरे', 'uddhav', 'उद्धव',
    'aaditya thackeray', 'आदित्य ठाकरे', 'युवासेना अध्यक्ष',
    'raj thackeray', 'राज ठाकरे', 'mns chief', 'मनसे अध्यक्ष',
    
    // NCP Leaders
    'sharad pawar', 'शरद पवार', 'sharad pawar saheb', 'शरद पवार साहेब',
    'supriya sule', 'सुप्रिया सुळे', 'sule', 'सुळे',
    'praful patel', 'प्रफुल्ल पटेल', 'patel', 'पटेल',
    
    // Congress Maharashtra
    'nana patole', 'नाना पटोले', 'patole', 'पटोले', 'congress state president',
    'balasaheb thorat', 'बालासाहेब थोरात', 'thorat', 'थोरात',
    'prithviraj chavan', 'पृथ्वीराज चव्हाण', 'chavan', 'चव्हाण',
    
    // BJP Maharashtra  
    'chandrakant patil', 'चंद्रकांत पाटील', 'chandrakant', 'चंद्रकांत',
    'girish mahajan', 'गिरीश महाजन', 'mahajan', 'महाजन',
    'raosaheb danve', 'राव साहेब डांगे', 'danve', 'डांगे',
    
    // Mumbai Politicians
    'milind deora', 'मिलिंद देवरा', 'deora', 'देवरा',
    'manoj jarange', 'मनोज जरांगे', 'jarange', 'जरांगे', 'maratha reservation',
    
    // Regional Leaders
    'chhagan bhujbal', 'छगन भुजबळ', 'bhujbal', 'भुजबळ',
    'jayant patil', 'जयंत पाटील', 'ncp jayant patil',
    'rohit pawar', 'रोहित पवार', 'young ncp leader',
    'dhananjay munde', 'धनंजय मुंडे', 'munde', 'मुंडे'
  ],

  // **TITLES & POSITIONS** 
  positions: [
    'मुख्यमंत्री', 'chief minister', 'cm', 'सीएम',
    'उपमुख्यमंत्री', 'deputy cm', 'deputy chief minister',
    'प्रधानमंत्री', 'prime minister', 'pm', 'पीएम',
    'गृहमंत्री', 'home minister', 'हओम मिनिस्टर',
    'संरक्षण मंत्री', 'defence minister', 'रक्षामंत्री',
    'पक्ष अध्यक्ष', 'party president', 'party chief',
    'विधानसभा अध्यक्ष', 'assembly speaker', 'स्पीकर',
    'विरोधी पक्ष नेता', 'opposition leader', 'leader of opposition'
  ],

  // **POLITICAL PARTIES**
  parties: [
    'भाजप', 'bjp', 'भारतीय जनता पार्टी',
    'शिवसेना', 'shiv sena', 'shivsena',
    'राष्ट्रवादी काँग्रेस', 'ncp', 'nationalist congress',
    'काँग्रेस', 'congress', 'indian national congress',
    'मनसे', 'mns', 'maharashtra navnirman sena',
    'वंचित बहुजन आघाडी', 'vba', 'vanchit bahujan aghadi',
    'aimim', 'एआयएमआयएम', 'असदुद्दीन ओवैसी'
  ]
};

async function updateRSSFeedKeywords() {
  try {
    // Connect to MongoDB
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_mentions');
    console.log('✅ Connected to MongoDB');

    // Get all enabled RSS feeds
    const feeds = await RSSFeed.find({ enabled: true });
    console.log(`📡 Found ${feeds.length} active RSS feeds to update`);

    // Combine all politician keywords
    const allPoliticianKeywords = [
      ...POLITICIAN_KEYWORDS.national,
      ...POLITICIAN_KEYWORDS.maharashtra, 
      ...POLITICIAN_KEYWORDS.positions,
      ...POLITICIAN_KEYWORDS.parties
    ];

    console.log(`🔍 Total politician keywords to add: ${allPoliticianKeywords.length}`);

    // Update each feed
    for (const feed of feeds) {
      const currentKeywords = feed.keywords || [];
      
      // Remove duplicates and add new politician keywords
      const enhancedKeywords = [
        ...new Set([
          ...currentKeywords,
          ...allPoliticianKeywords
        ])
      ];

      const addedCount = enhancedKeywords.length - currentKeywords.length;
      
      if (addedCount > 0) {
        await RSSFeed.findByIdAndUpdate(feed._id, {
          keywords: enhancedKeywords,
          updatedAt: new Date()
        });

        console.log(`✅ Updated ${feed.name}:`);
        console.log(`   - Previous keywords: ${currentKeywords.length}`);
        console.log(`   - New keywords added: ${addedCount}`);
        console.log(`   - Total keywords: ${enhancedKeywords.length}`);
      } else {
        console.log(`⚪ ${feed.name}: Already up to date`);
      }
    }

    console.log('\n🎯 **KEYWORD UPDATE SUMMARY**');
    console.log('═══════════════════════════════════════');
    console.log('📊 **Politician Keywords Added:**');
    console.log(`   • National Politicians: ${POLITICIAN_KEYWORDS.national.length}`);
    console.log(`   • Maharashtra Politicians: ${POLITICIAN_KEYWORDS.maharashtra.length}`);
    console.log(`   • Political Positions: ${POLITICIAN_KEYWORDS.positions.length}`);
    console.log(`   • Political Parties: ${POLITICIAN_KEYWORDS.parties.length}`);
    console.log(`   • **Total Keywords: ${allPoliticianKeywords.length}**`);
    
    console.log('\n🔍 **Key Politicians Covered:**');
    console.log('   • PM Narendra Modi, Amit Shah, Rajnath Singh');
    console.log('   • Rahul Gandhi, Sonia Gandhi, Priyanka Gandhi');  
    console.log('   • Eknath Shinde, Devendra Fadnavis, Ajit Pawar');
    console.log('   • Uddhav Thackeray, Sharad Pawar, Raj Thackeray');
    console.log('   • Yogi Adityanath, Mamata Banerjee, Arvind Kejriwal');
    
    console.log('\n🎯 **Next Steps:**');
    console.log('   1. RSS polling will now detect these politician mentions');
    console.log('   2. Videos mentioning politicians will be captured in Raw Feed');
    console.log('   3. Use Mentions Manager to process relevant political content');
    console.log('   4. Generate clips for important political statements');

  } catch (error) {
    console.error('❌ Error updating RSS feed keywords:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
    console.log('🎉 Politician keywords update completed successfully!');
  }
}

// Run the update
if (require.main === module) {
  updateRSSFeedKeywords();
}

module.exports = { updateRSSFeedKeywords, POLITICIAN_KEYWORDS };
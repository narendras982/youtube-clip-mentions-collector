import React, { useState, useEffect } from 'react';
import {
  Card,
  Tabs,
  Button,
  Space,
  Badge,
  notification,
  Row,
  Col,
  Statistic,
  Typography,
  Alert
} from 'antd';
import {
  PlayCircleOutlined,
  FileSearchOutlined,
  VideoCameraOutlined,
  BarChartOutlined,
  SyncOutlined
} from '@ant-design/icons';
import RawVideoPanel from './RawVideoPanel';
import ProcessedMentionsPanel from './ProcessedMentionsPanel';
import ClipLibraryPanel from './ClipLibraryPanel';
import ProcessingStatusTab from './ProcessingStatusTab';
import { mentionsApi, rawVideosApi, clipsApi } from '../services/api';

const { TabPane } = Tabs;
const { Title } = Typography;

const MentionsManager = () => {
  const [activeTab, setActiveTab] = useState('raw');
  const [loading, setLoading] = useState(false);
  const [statistics, setStatistics] = useState({
    raw_videos: { total: 0, pending: 0, selected: 0, processed: 0 },
    mentions: { total: 0, verified: 0, clips_generated: 0 },
    clips: { total: 0, ready: 0, processing: 0 }
  });

  // Selection state management
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const [processingStatus, setProcessingStatus] = useState({});

  useEffect(() => {
    loadOverviewStatistics();
    loadSelectedVideos();
  }, []);

  useEffect(() => {
    // Auto-refresh statistics when tab changes
    loadOverviewStatistics();
  }, [activeTab]);

  const loadOverviewStatistics = async () => {
    try {
      setLoading(true);

      // Load statistics from all three endpoints in parallel
      const [rawVideosStats, mentionsStats, clipsStats] = await Promise.all([
        rawVideosApi.getOverviewStats(),
        mentionsApi.getAnalytics(),
        clipsApi.getAnalytics()
      ]);

      setStatistics({
        raw_videos: rawVideosStats.data?.data?.overview || {},
        mentions: mentionsStats.data?.data?.overall || {},
        clips: clipsStats.data?.data?.overview || {}
      });

    } catch (error) {
      console.error('Error loading statistics:', error);
      notification.error({
        message: 'Statistics Error',
        description: 'Failed to load overview statistics. Please try refreshing.'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedVideos = async () => {
    try {
      // Get videos that are already marked as selected in the database
      const response = await rawVideosApi.getRawVideos({
        status: 'selected',
        limit: 100  // Get up to 100 selected videos
      });

      if (response.data.success && response.data.data.videos) {
        const selectedVideoIds = response.data.data.videos.map(video => video.video_id);
        setSelectedVideos(selectedVideoIds);
        
        if (selectedVideoIds.length > 0) {
          console.log(`Loaded ${selectedVideoIds.length} previously selected videos`);
        }
      }
    } catch (error) {
      console.warn('Failed to load previously selected videos:', error);
      // Don't show error to user as this is not critical functionality
    }
  };

  const handleVideoSelection = (videoIds, action = 'toggle') => {
    if (action === 'toggle') {
      const newSelection = selectedVideos.includes(videoIds[0])
        ? selectedVideos.filter(id => id !== videoIds[0])
        : [...selectedVideos, ...videoIds.filter(id => !selectedVideos.includes(id))];
      setSelectedVideos(newSelection);
    } else if (action === 'add') {
      setSelectedVideos(prev => [...prev, ...videoIds.filter(id => !prev.includes(id))]);
    } else if (action === 'clear') {
      setSelectedVideos([]);
    } else if (action === 'set') {
      setSelectedVideos(videoIds);
    }
  };

  const handleMentionSelection = (mentionIds, action = 'toggle') => {
    if (action === 'toggle') {
      const newSelection = selectedMentions.includes(mentionIds[0])
        ? selectedMentions.filter(id => id !== mentionIds[0])
        : [...selectedMentions, ...mentionIds.filter(id => !selectedMentions.includes(id))];
      setSelectedMentions(newSelection);
    } else if (action === 'add') {
      setSelectedMentions(prev => [...prev, ...mentionIds.filter(id => !prev.includes(id))]);
    } else if (action === 'clear') {
      setSelectedMentions([]);
    } else if (action === 'set') {
      setSelectedMentions(mentionIds);
    }
  };

  const handleBatchVideoProcessing = async () => {
    if (selectedVideos.length === 0) {
      notification.warning({
        message: 'No Videos Selected',
        description: 'Please select videos to process first.'
      });
      return;
    }

    try {
      setProcessingStatus({ status: 'processing', count: selectedVideos.length });

      const response = await rawVideosApi.processVideos({
        video_ids: selectedVideos,
        processing_options: {
          use_fuzzy_matching: true,
          fuzzy_threshold: 0.8,
          enable_sentiment: true,
          languages: ['mr', 'hi', 'en']
        }
      });

      if (response.data.success) {
        notification.success({
          message: 'Processing Started',
          description: `${response.data.data.total_queued} videos queued for mention detection processing.`,
          duration: 5
        });

        // Clear selection and refresh statistics
        setSelectedVideos([]);
        setTimeout(() => {
          loadOverviewStatistics();
          setProcessingStatus({});
        }, 2000);
      }

    } catch (error) {
      console.error('Error processing videos:', error);
      notification.error({
        message: 'Processing Failed',
        description: error.response?.data?.message || 'Failed to start video processing.'
      });
      setProcessingStatus({});
    }
  };

  const handleBatchMentionAction = async (action) => {
    if (selectedMentions.length === 0) {
      notification.warning({
        message: 'No Mentions Selected',
        description: 'Please select mentions first.'
      });
      return;
    }

    try {
      const response = await mentionsApi.bulkAction({
        action: action,
        mention_ids: selectedMentions,
        action_by: 'user',
        clip_settings: {
          format: 'mp4',
          quality: '720p',
          context_padding: 20
        }
      });

      if (response.data.success) {
        notification.success({
          message: `Bulk ${action} Completed`,
          description: response.data.message,
          duration: 5
        });

        // Clear selection and refresh statistics
        setSelectedMentions([]);
        setTimeout(() => {
          loadOverviewStatistics();
        }, 2000);
      }

    } catch (error) {
      console.error(`Error performing ${action}:`, error);
      notification.error({
        message: `${action} Failed`,
        description: error.response?.data?.message || `Failed to ${action} mentions.`
      });
    }
  };

  const getTabBadgeCount = (tab) => {
    switch (tab) {
      case 'raw':
        return statistics.raw_videos.pending || 0;
      case 'processed':
        return statistics.mentions.total || 0;
      case 'clips':
        return statistics.clips.ready || 0;
      default:
        return 0;
    }
  };

  const renderTabTitle = (title, icon, badgeCount) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {icon}
      {title}
      {badgeCount > 0 && <Badge count={badgeCount} size="small" />}
    </span>
  );

  const renderOverviewStats = () => (
    <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
      <Col xs={24} sm={6}>
        <Card>
          <Statistic
            title="Raw Videos"
            value={statistics.raw_videos.total || 0}
            prefix={<FileSearchOutlined />}
            valueStyle={{ color: '#1890ff' }}
            suffix={
              <div style={{ fontSize: '12px', color: '#666' }}>
                {statistics.raw_videos.pending || 0} pending
              </div>
            }
          />
        </Card>
      </Col>
      <Col xs={24} sm={6}>
        <Card>
          <Statistic
            title="Processed Mentions"
            value={statistics.mentions.total || 0}
            prefix={<PlayCircleOutlined />}
            valueStyle={{ color: '#52c41a' }}
            suffix={
              <div style={{ fontSize: '12px', color: '#666' }}>
                {statistics.mentions.verified || 0} verified
              </div>
            }
          />
        </Card>
      </Col>
      <Col xs={24} sm={6}>
        <Card>
          <Statistic
            title="Generated Clips"
            value={statistics.clips.total || 0}
            prefix={<VideoCameraOutlined />}
            valueStyle={{ color: '#fa8c16' }}
            suffix={
              <div style={{ fontSize: '12px', color: '#666' }}>
                {statistics.clips.ready || 0} ready
              </div>
            }
          />
        </Card>
      </Col>
      <Col xs={24} sm={6}>
        <Card>
          <Statistic
            title="Processing Queue"
            value={Object.keys(processingStatus).length}
            prefix={<SyncOutlined spin={Object.keys(processingStatus).length > 0} />}
            valueStyle={{ 
              color: Object.keys(processingStatus).length > 0 ? '#fa8c16' : '#666' 
            }}
          />
        </Card>
      </Col>
    </Row>
  );

  const renderGlobalActions = () => (
    <Space style={{ marginBottom: '16px' }}>
      <Button 
        icon={<SyncOutlined />}
        onClick={loadOverviewStatistics}
        loading={loading}
      >
        Refresh Stats
      </Button>
      
      {activeTab === 'raw' && (
        <>
          <Button
            type="primary"
            disabled={selectedVideos.length === 0}
            loading={processingStatus.status === 'processing'}
            onClick={handleBatchVideoProcessing}
          >
            Process Selected Videos ({selectedVideos.length})
          </Button>
          <Button onClick={() => handleVideoSelection([], 'clear')}>
            Clear Selection
          </Button>
        </>
      )}
      
      {activeTab === 'processed' && (
        <Space>
          <Button
            type="primary"
            disabled={selectedMentions.length === 0}
            onClick={() => handleBatchMentionAction('create_clips')}
          >
            Create Clips ({selectedMentions.length})
          </Button>
          <Button
            disabled={selectedMentions.length === 0}
            onClick={() => handleBatchMentionAction('approve')}
          >
            Approve Selected
          </Button>
          <Button
            disabled={selectedMentions.length === 0}
            onClick={() => handleBatchMentionAction('reject')}
          >
            Reject Selected
          </Button>
          <Button onClick={() => handleMentionSelection([], 'clear')}>
            Clear Selection
          </Button>
        </Space>
      )}
    </Space>
  );

  return (
    <div style={{ padding: '20px' }}>
      <Title level={2}>
        <BarChartOutlined style={{ marginRight: '10px', color: '#1890ff' }} />
        Mentions Management
      </Title>

      <Alert
        style={{ marginBottom: '20px' }}
        message="Mentions Management Hub"
        description={
          <div>
            <div style={{ marginBottom: '8px' }}>
              Centralized interface for managing raw RSS videos, processed mentions, and generated clips. 
              Use the tabs below to navigate between different stages of the mention detection workflow.
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              <strong>Raw Feed:</strong> Select and process videos from RSS feeds • 
              <strong> Processed Mentions:</strong> Review detected mentions and create clips • 
              <strong> Clip Library:</strong> Manage and download generated video clips
            </div>
          </div>
        }
        type="info"
        showIcon
        closable
      />

      {renderOverviewStats()}
      {renderGlobalActions()}

      <Card>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          type="card"
          style={{ margin: '-16px -16px 0 -16px' }}
        >
          <TabPane
            tab={renderTabTitle(
              'Raw Feed', 
              <FileSearchOutlined />, 
              getTabBadgeCount('raw')
            )}
            key="raw"
          >
            <RawVideoPanel
              selectedVideos={selectedVideos}
              onVideoSelect={handleVideoSelection}
              processingStatus={processingStatus}
              onProcessingComplete={() => {
                setProcessingStatus({});
                loadOverviewStatistics();
              }}
              onVideosMarkedAsSelected={(videoIds) => {
                // Update local state to include newly marked videos
                setSelectedVideos(prev => [...prev, ...videoIds.filter(id => !prev.includes(id))]);
                loadOverviewStatistics(); // Refresh stats
              }}
            />
          </TabPane>
          
          <TabPane
            tab={renderTabTitle(
              'Processed Mentions', 
              <PlayCircleOutlined />, 
              getTabBadgeCount('processed')
            )}
            key="processed"
          >
            <ProcessedMentionsPanel
              selectedMentions={selectedMentions}
              onMentionSelect={handleMentionSelection}
              onClipsGenerated={() => {
                loadOverviewStatistics();
              }}
            />
          </TabPane>
          
          <TabPane
            tab={renderTabTitle(
              'Clip Library', 
              <VideoCameraOutlined />, 
              getTabBadgeCount('clips')
            )}
            key="clips"
          >
            <ClipLibraryPanel
              onClipAction={() => {
                loadOverviewStatistics();
              }}
            />
          </TabPane>

          <TabPane
            tab={renderTabTitle(
              'Processing Status', 
              <SyncOutlined />, 
              null
            )}
            key="processing"
          >
            <ProcessingStatusTab />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default MentionsManager;
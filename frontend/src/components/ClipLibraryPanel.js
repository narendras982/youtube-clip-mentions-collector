import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Tag,
  Tooltip,
  notification,
  Input,
  Select,
  DatePicker,
  Row,
  Col,
  Statistic,
  Typography,
  Badge,
  Progress,
  Modal,
  Rate,
  Popconfirm,
  Divider,
  Image,
  Tabs
} from 'antd';
import {
  PlayCircleOutlined,
  YoutubeOutlined,
  CalendarOutlined,
  DownloadOutlined,
  EyeOutlined,
  ShareAltOutlined,
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  VideoCameraOutlined,
  SearchOutlined,
  ClearOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  CheckOutlined,
  CloseOutlined,
  SoundOutlined
} from '@ant-design/icons';
import { clipsApi } from '../services/api';

const { Search } = Input;
const { Option } = Select;
const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;
const { TextArea } = Input;
const { TabPane } = Tabs;

const ClipLibraryPanel = ({ onClipAction }) => {
  const [loading, setLoading] = useState(false);
  const [clips, setClips] = useState([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });
  
  // Filter states
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    sentiment: '',
    detected_keyword: '',
    language: '',
    min_confidence: null,
    created_by: '',
    dateRange: null,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const [analytics, setAnalytics] = useState({
    total_clips: 0,
    ready_clips: 0,
    processing_clips: 0,
    total_size: 0,
    avg_duration: 0,
    format_breakdown: [],
    quality_breakdown: []
  });

  const [detailModal, setDetailModal] = useState({
    visible: false,
    clip: null
  });

  const [editModal, setEditModal] = useState({
    visible: false,
    clip: null,
    form: {}
  });

  const [shareModal, setShareModal] = useState({
    visible: false,
    clip: null,
    shareData: null
  });

  const [videoModal, setVideoModal] = useState({
    visible: false,
    clip: null,
    videoId: null,
    startTime: 0
  });

  useEffect(() => {
    loadClips();
    loadAnalytics();
  }, [pagination.current, pagination.pageSize, filters]);

  const loadClips = async () => {
    try {
      setLoading(true);
      
      const params = {
        page: pagination.current,
        limit: pagination.pageSize,
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder
      };

      // Add filters
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.sentiment) params.sentiment = filters.sentiment;
      if (filters.detected_keyword) params.detected_keyword = filters.detected_keyword;
      if (filters.language) params.language = filters.language;
      if (filters.min_confidence) params.min_confidence = filters.min_confidence;
      if (filters.created_by) params.created_by = filters.created_by;
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.date_from = filters.dateRange[0].toISOString();
        params.date_to = filters.dateRange[1].toISOString();
      }

      const response = await clipsApi.getClips(params);
      
      if (response.data.success) {
        setClips(response.data.data.clips);
        setPagination(prev => ({
          ...prev,
          total: response.data.data.pagination.total
        }));
      }

    } catch (error) {
      console.error('Error loading clips:', error);
      notification.error({
        message: 'Error Loading Clips',
        description: 'Failed to load clips. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    try {
      const response = await clipsApi.getAnalytics();
      
      if (response.data.success) {
        setAnalytics(response.data.data.overview || {});
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    }
  };

  const handleSearch = (value) => {
    setFilters(prev => ({ ...prev, search: value }));
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: '',
      sentiment: '',
      detected_keyword: '',
      language: '',
      min_confidence: null,
      created_by: '',
      dateRange: null,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleDownload = async (clipId) => {
    try {
      const response = await clipsApi.downloadClip(clipId);
      // Browser should handle the download
      notification.success({
        message: 'Download Started',
        description: 'The clip download has started.'
      });
    } catch (error) {
      notification.error({
        message: 'Download Failed',
        description: error.response?.data?.message || 'Failed to download clip.'
      });
    }
  };

  const handleShare = async (clip) => {
    try {
      const response = await clipsApi.shareClip(clip._id, {
        expiration_hours: 24,
        public_access: true
      });

      if (response.data.success) {
        setShareModal({
          visible: true,
          clip: clip,
          shareData: response.data.data
        });
      }
    } catch (error) {
      notification.error({
        message: 'Share Failed',
        description: error.response?.data?.message || 'Failed to generate share link.'
      });
    }
  };

  const handleDelete = async (clipId) => {
    try {
      const response = await clipsApi.deleteClip(clipId, { remove_file: true });

      if (response.data.success) {
        notification.success({
          message: 'Clip Deleted',
          description: 'Clip and file have been permanently deleted.'
        });
        loadClips();
        loadAnalytics();
        onClipAction();
      }
    } catch (error) {
      notification.error({
        message: 'Delete Failed',
        description: error.response?.data?.message || 'Failed to delete clip.'
      });
    }
  };

  const handleEdit = (clip) => {
    setEditModal({
      visible: true,
      clip: clip,
      form: {
        title: clip.title,
        description: clip.description,
        tags: clip.tags || [],
        user_rating: clip.user_rating || 0,
        user_notes: clip.user_notes || ''
      }
    });
  };

  const handleSaveEdit = async () => {
    try {
      const response = await clipsApi.updateClip(editModal.clip._id, editModal.form);

      if (response.data.success) {
        notification.success({
          message: 'Clip Updated',
          description: 'Clip metadata has been updated successfully.'
        });
        setEditModal({ visible: false, clip: null, form: {} });
        loadClips();
      }
    } catch (error) {
      notification.error({
        message: 'Update Failed',
        description: error.response?.data?.message || 'Failed to update clip.'
      });
    }
  };

  const handlePlayVideo = (clip) => {
    setVideoModal({
      visible: true,
      clip: clip,
      videoId: clip.source_video_id,
      startTime: Math.floor(clip.start_time)
    });
  };

  const handleCloseVideo = () => {
    setVideoModal({
      visible: false,
      clip: null,
      videoId: null,
      startTime: 0
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'processing',
      processing: 'warning',
      ready: 'success',
      error: 'error',
      deleted: 'default'
    };
    return colors[status] || 'default';
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: <LoadingOutlined />,
      processing: <LoadingOutlined spin />,
      ready: <CheckOutlined />,
      error: <CloseOutlined />,
      deleted: <DeleteOutlined />
    };
    return icons[status];
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const columns = [
    {
      title: 'Clip Details',
      key: 'details',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ position: 'relative' }}>
            <img
              src={record.source_metadata?.thumbnail_url || '/placeholder-video.png'}
              alt="thumbnail"
              style={{ 
                width: 80, 
                height: 60, 
                borderRadius: '4px', 
                objectFit: 'cover',
                cursor: 'pointer',
                border: '2px solid transparent',
                transition: 'border-color 0.2s'
              }}
              onClick={() => handlePlayVideo(record)}
              onMouseOver={(e) => e.target.style.borderColor = '#1890ff'}
              onMouseOut={(e) => e.target.style.borderColor = 'transparent'}
            />
            <PlayCircleOutlined
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '24px',
                color: 'white',
                textShadow: '0 0 4px rgba(0,0,0,0.5)',
                cursor: 'pointer'
              }}
              onClick={() => handlePlayVideo(record)}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              <Tooltip title={`Click to watch at ${Math.floor(record.start_time)}s`}>
                <Text 
                  ellipsis 
                  style={{ 
                    maxWidth: '250px', 
                    display: 'block',
                    cursor: 'pointer',
                    color: '#1890ff'
                  }}
                  onClick={() => handlePlayVideo(record)}
                >
                  {record.title}
                </Text>
              </Tooltip>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>
              <Space size="small">
                <Tag color="blue">{record.mention_context?.detected_keyword}</Tag>
                <Tag color={record.mention_context?.sentiment === 'positive' ? 'green' : record.mention_context?.sentiment === 'negative' ? 'red' : 'default'}>
                  {record.mention_context?.sentiment}
                </Tag>
                <Text>{record.source_metadata?.channel_name}</Text>
              </Space>
            </div>
            <div style={{ fontSize: '11px', color: '#999' }}>
              <Space size="small">
                <CalendarOutlined />
                {new Date(record.createdAt).toLocaleDateString()}
                <Text>⏱ {Math.floor(record.start_time)}s-{Math.floor(record.end_time)}s</Text>
                <SoundOutlined />
                {formatDuration(record.duration)}
                <Text>🎯 {Math.round(record.mention_context?.confidence_score * 100)}%</Text>
              </Space>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Format & Quality',
      key: 'format',
      width: 120,
      render: (_, record) => (
        <Space direction="vertical" size="small">
          <Tag color="orange">{record.format?.toUpperCase()}</Tag>
          <Tag color="green">{record.quality}</Tag>
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (status, record) => (
        <Space direction="vertical" size="small">
          <Tag color={getStatusColor(status)} icon={getStatusIcon(status)}>
            {status?.toUpperCase()}
          </Tag>
          {status === 'processing' && record.processing_progress && (
            <Progress size="small" percent={record.processing_progress} />
          )}
        </Space>
      )
    },
    {
      title: 'User Rating',
      dataIndex: 'user_rating',
      width: 120,
      render: (rating) => (
        <Rate disabled value={rating || 0} style={{ fontSize: '14px' }} />
      )
    },
    {
      title: 'Actions',
      width: 200,
      render: (_, record) => (
        <Space wrap>
          <Tooltip title="View Details">
            <Button
              size="small"
              icon={<InfoCircleOutlined />}
              onClick={() => setDetailModal({ visible: true, clip: record })}
            />
          </Tooltip>

          <Tooltip title="Watch at Timestamp">
            <Button
              size="small"
              type="primary"
              icon={<YoutubeOutlined />}
              onClick={() => handlePlayVideo(record)}
            />
          </Tooltip>

          <Tooltip title="Watch Full Video">
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => window.open(record.source_metadata?.original_url, '_blank')}
            />
          </Tooltip>

          <Tooltip title="Copy Timestamp URL">
            <Button
              size="small"
              icon={<ShareAltOutlined />}
              onClick={() => {
                const youtubeUrl = `https://www.youtube.com/watch?v=${record.source_video_id}&t=${Math.floor(record.start_time)}s`;
                navigator.clipboard.writeText(youtubeUrl);
                notification.success({
                  message: 'URL Copied',
                  description: 'YouTube timestamp URL copied to clipboard!'
                });
              }}
            />
          </Tooltip>

          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>

          <Popconfirm
            title="Delete this clip?"
            description="This action cannot be undone. The file will be permanently deleted."
            onConfirm={() => handleDelete(record._id)}
            okText="Delete"
            cancelText="Cancel"
            okType="danger"
          >
            <Tooltip title="Delete">
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const renderFilters = () => (
    <Card style={{ marginBottom: '16px' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={6}>
          <Search
            placeholder="Search clips..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            onSearch={handleSearch}
            allowClear
          />
        </Col>
        <Col xs={24} sm={3}>
          <Select
            placeholder="Sentiment"
            value={filters.sentiment}
            onChange={(value) => handleFilterChange('sentiment', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="positive">Positive</Option>
            <Option value="negative">Negative</Option>
            <Option value="neutral">Neutral</Option>
          </Select>
        </Col>
        <Col xs={24} sm={4}>
          <Input
            placeholder="Politician/Keyword..."
            value={filters.detected_keyword}
            onChange={(e) => setFilters(prev => ({ ...prev, detected_keyword: e.target.value }))}
            allowClear
            prefix={<SearchOutlined />}
          />
        </Col>
        <Col xs={24} sm={3}>
          <Select
            placeholder="Language"
            value={filters.language}
            onChange={(value) => handleFilterChange('language', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="en">English</Option>
            <Option value="hi">Hindi</Option>
            <Option value="mr">Marathi</Option>
            <Option value="auto">Auto</Option>
          </Select>
        </Col>
        <Col xs={24} sm={3}>
          <Select
            placeholder="Confidence"
            value={filters.min_confidence}
            onChange={(value) => handleFilterChange('min_confidence', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value={0.9}>Very High (90%+)</Option>
            <Option value={0.8}>High (80%+)</Option>
            <Option value={0.7}>Medium (70%+)</Option>
            <Option value={0.5}>Low (50%+)</Option>
          </Select>
        </Col>
        <Col xs={24} sm={4}>
          <RangePicker
            value={filters.dateRange}
            onChange={(dates) => handleFilterChange('dateRange', dates)}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} sm={4}>
          <Button
            icon={<ClearOutlined />}
            onClick={clearFilters}
          >
            Clear
          </Button>
        </Col>
      </Row>
    </Card>
  );

  const renderAnalytics = () => (
    <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
      <Col span={6}>
        <Card>
          <Statistic
            title="Total Clips"
            value={analytics.total_clips || 0}
            prefix={<VideoCameraOutlined />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Ready Clips"
            value={analytics.ready_clips || 0}
            valueStyle={{ color: '#52c41a' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Total Size"
            value={formatFileSize(analytics.total_size || 0)}
            valueStyle={{ color: '#1890ff' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Avg Duration"
            value={formatDuration(analytics.avg_duration || 0)}
            valueStyle={{ color: '#fa8c16' }}
          />
        </Card>
      </Col>
    </Row>
  );

  const renderDetailModal = () => (
    <Modal
      title="Clip Details"
      open={detailModal.visible}
      onCancel={() => setDetailModal({ visible: false, clip: null })}
      width={900}
      footer={[
        <Button key="close" onClick={() => setDetailModal({ visible: false, clip: null })}>
          Close
        </Button>,
        detailModal.clip?.status === 'ready' && (
          <Button 
            key="download" 
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(detailModal.clip._id)}
          >
            Download
          </Button>
        )
      ]}
    >
      {detailModal.clip && (
        <Tabs defaultActiveKey="1">
          <TabPane tab="Basic Info" key="1">
            <Row gutter={16}>
              <Col span={12}>
                <p><strong>Title:</strong> {detailModal.clip.title}</p>
                <p><strong>Format:</strong> {detailModal.clip.format?.toUpperCase()}</p>
                <p><strong>Quality:</strong> {detailModal.clip.quality}</p>
                <p><strong>Duration:</strong> {formatDuration(detailModal.clip.duration)}</p>
                <p><strong>File Size:</strong> {formatFileSize(detailModal.clip.file_size)}</p>
                <p><strong>Status:</strong> {detailModal.clip.status}</p>
              </Col>
              <Col span={12}>
                <p><strong>Created:</strong> {new Date(detailModal.clip.createdAt).toLocaleString()}</p>
                <p><strong>Download Count:</strong> {detailModal.clip.download_count || 0}</p>
                <p><strong>View Count:</strong> {detailModal.clip.view_count || 0}</p>
                <p><strong>User Rating:</strong> <Rate disabled value={detailModal.clip.user_rating || 0} /></p>
                <p><strong>Public Access:</strong> {detailModal.clip.public_access ? 'Yes' : 'No'}</p>
              </Col>
            </Row>
            {detailModal.clip.description && (
              <>
                <Divider />
                <p><strong>Description:</strong></p>
                <Paragraph>{detailModal.clip.description}</Paragraph>
              </>
            )}
          </TabPane>
          <TabPane tab="Source & Mention" key="2">
            <p><strong>Detected Keyword:</strong> {detailModal.clip.mention_context?.detected_keyword}</p>
            <p><strong>Confidence:</strong> {Math.round(detailModal.clip.mention_context?.confidence_score * 100)}%</p>
            <p><strong>Sentiment:</strong> {detailModal.clip.mention_context?.sentiment}</p>
            <p><strong>Language:</strong> {detailModal.clip.mention_context?.language}</p>
            <p><strong>Channel:</strong> {detailModal.clip.source_metadata?.channel_name}</p>
            <p><strong>Original Video:</strong> {detailModal.clip.source_metadata?.original_title}</p>
            <Divider />
            <p><strong>Mention Text:</strong></p>
            <Paragraph style={{ background: '#f5f5f5', padding: '12px', borderRadius: '6px' }}>
              {detailModal.clip.mention_context?.mention_text}
            </Paragraph>
          </TabPane>
          <TabPane tab="Generation Settings" key="3">
            <Row gutter={16}>
              <Col span={12}>
                <p><strong>Format:</strong> {detailModal.clip.generation_settings?.format}</p>
                <p><strong>Quality:</strong> {detailModal.clip.generation_settings?.quality}</p>
                <p><strong>Context Padding:</strong> {detailModal.clip.generation_settings?.context_padding}s</p>
                <p><strong>Audio Only:</strong> {detailModal.clip.generation_settings?.audio_only ? 'Yes' : 'No'}</p>
              </Col>
              <Col span={12}>
                <p><strong>Include Subtitles:</strong> {detailModal.clip.generation_settings?.include_subtitles ? 'Yes' : 'No'}</p>
                <p><strong>Watermark:</strong> {detailModal.clip.generation_settings?.watermark ? 'Yes' : 'No'}</p>
                <p><strong>Start Time:</strong> {detailModal.clip.start_time}s</p>
                <p><strong>End Time:</strong> {detailModal.clip.end_time}s</p>
              </Col>
            </Row>
          </TabPane>
        </Tabs>
      )}
    </Modal>
  );

  const renderEditModal = () => (
    <Modal
      title="Edit Clip"
      open={editModal.visible}
      onCancel={() => setEditModal({ visible: false, clip: null, form: {} })}
      onOk={handleSaveEdit}
      okText="Save Changes"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <label><strong>Title:</strong></label>
          <Input
            value={editModal.form.title}
            onChange={(e) => setEditModal(prev => ({ ...prev, form: { ...prev.form, title: e.target.value } }))}
          />
        </div>
        <div>
          <label><strong>Description:</strong></label>
          <TextArea
            value={editModal.form.description}
            onChange={(e) => setEditModal(prev => ({ ...prev, form: { ...prev.form, description: e.target.value } }))}
            rows={3}
          />
        </div>
        <div>
          <label><strong>User Rating:</strong></label>
          <Rate
            value={editModal.form.user_rating}
            onChange={(value) => setEditModal(prev => ({ ...prev, form: { ...prev.form, user_rating: value } }))}
          />
        </div>
        <div>
          <label><strong>Notes:</strong></label>
          <TextArea
            value={editModal.form.user_notes}
            onChange={(e) => setEditModal(prev => ({ ...prev, form: { ...prev.form, user_notes: e.target.value } }))}
            rows={2}
          />
        </div>
      </Space>
    </Modal>
  );

  const renderShareModal = () => (
    <Modal
      title="Share Clip"
      open={shareModal.visible}
      onCancel={() => setShareModal({ visible: false, clip: null, shareData: null })}
      footer={[
        <Button key="close" onClick={() => setShareModal({ visible: false, clip: null, shareData: null })}>
          Close
        </Button>
      ]}
    >
      {shareModal.shareData && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <strong>Share URL:</strong>
            <Input.Group compact>
              <Input 
                value={shareModal.shareData.share_url} 
                readOnly
                style={{ width: 'calc(100% - 80px)' }}
              />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(shareModal.shareData.share_url);
                  notification.success({ message: 'URL copied to clipboard!' });
                }}
              >
                Copy
              </Button>
            </Input.Group>
          </div>
          <p><strong>Access Token:</strong> {shareModal.shareData.access_token}</p>
          <p><strong>Expires:</strong> {new Date(shareModal.shareData.expires_at).toLocaleString()}</p>
          <p><strong>Public Access:</strong> {shareModal.shareData.public_access ? 'Yes' : 'No'}</p>
        </Space>
      )}
    </Modal>
  );

  const renderVideoModal = () => (
    <Modal
      title={
        <Space>
          <YoutubeOutlined style={{ color: '#ff4d4f' }} />
          <span>{videoModal.clip?.mention_context?.detected_keyword}</span>
          <Tag color={videoModal.clip?.mention_context?.sentiment === 'positive' ? 'green' : 
                     videoModal.clip?.mention_context?.sentiment === 'negative' ? 'red' : 'default'}>
            {videoModal.clip?.mention_context?.sentiment}
          </Tag>
        </Space>
      }
      open={videoModal.visible}
      onCancel={handleCloseVideo}
      width={900}
      footer={[
        <Button key="timestamp" icon={<ShareAltOutlined />} onClick={() => {
          const youtubeUrl = `https://www.youtube.com/watch?v=${videoModal.videoId}&t=${videoModal.startTime}s`;
          navigator.clipboard.writeText(youtubeUrl);
          notification.success({ message: 'Timestamp URL copied to clipboard!' });
        }}>
          Copy Timestamp URL
        </Button>,
        <Button key="external" icon={<YoutubeOutlined />} onClick={() => {
          const youtubeUrl = `https://www.youtube.com/watch?v=${videoModal.videoId}&t=${videoModal.startTime}s`;
          window.open(youtubeUrl, '_blank');
        }}>
          Open in YouTube
        </Button>,
        <Button key="close" onClick={handleCloseVideo}>
          Close
        </Button>
      ]}
      bodyStyle={{ padding: 0 }}
    >
      {videoModal.visible && videoModal.videoId && (
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
          <iframe
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none'
            }}
            src={`https://www.youtube.com/embed/${videoModal.videoId}?start=${videoModal.startTime}&autoplay=1&rel=0`}
            title="YouTube video player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      
      {videoModal.clip && (
        <div style={{ padding: '16px' }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div>
              <Text strong>Channel:</Text> {videoModal.clip.source_metadata?.channel_name}
            </div>
            <div>
              <Text strong>Confidence:</Text> {Math.round(videoModal.clip.mention_context?.confidence_score * 100)}%
            </div>
            <div>
              <Text strong>Time Range:</Text> {Math.floor(videoModal.clip.start_time)}s - {Math.floor(videoModal.clip.end_time)}s
            </div>
            <div>
              <Text strong>Duration:</Text> {formatDuration(videoModal.clip.duration)}
            </div>
            {videoModal.clip.mention_context?.mention_text && (
              <div>
                <Text strong>Mention Context:</Text>
                <div style={{ 
                  background: '#f5f5f5', 
                  padding: '8px', 
                  borderRadius: '4px', 
                  marginTop: '4px',
                  fontSize: '13px' 
                }}>
                  {videoModal.clip.mention_context.mention_text}
                </div>
              </div>
            )}
          </Space>
        </div>
      )}
    </Modal>
  );

  return (
    <div>
      {renderAnalytics()}
      {renderFilters()}
      
      <Card>
        <Table
          columns={columns}
          dataSource={clips}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} clips`,
            onChange: (page, pageSize) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: pageSize
              }));
            }
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>

      {renderDetailModal()}
      {renderEditModal()}
      {renderShareModal()}
      {renderVideoModal()}
    </div>
  );
};

export default ClipLibraryPanel;
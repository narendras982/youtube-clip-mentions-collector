import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Progress,
  Tag,
  Button,
  Row,
  Col,
  Statistic,
  Timeline,
  Typography,
  Space,
  Alert,
  Spin,
  Modal,
  List,
  Tooltip
} from 'antd';
import {
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { rawVideosApi } from '../services/api';

const { Title, Text } = Typography;

const ProcessingStatusTab = () => {
  const [loading, setLoading] = useState(false);
  const [processingData, setProcessingData] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSteps, setVideoSteps] = useState(null);
  const [stepsModalVisible, setStepsModalVisible] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(null);

  // Load processing status
  const loadProcessingStatus = async () => {
    try {
      setLoading(true);
      const response = await rawVideosApi.getProcessingStatus();
      if (response.data.success) {
        setProcessingData(response.data.data);
      }
    } catch (error) {
      console.error('Error loading processing status:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load video processing steps
  const loadVideoSteps = async (videoId) => {
    try {
      const response = await rawVideosApi.getVideoProcessingSteps(videoId);
      if (response.data.success) {
        setVideoSteps(response.data.data);
        setStepsModalVisible(true);
      }
    } catch (error) {
      console.error('Error loading video steps:', error);
    }
  };

  // Auto-refresh effect
  useEffect(() => {
    loadProcessingStatus();

    if (autoRefresh) {
      const interval = setInterval(loadProcessingStatus, 5000);
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }
  }, [autoRefresh]);

  // Format duration
  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // Get status color
  const getStatusColor = (status) => {
    const colors = {
      'processing': 'blue',
      'completed': 'green',
      'error': 'red',
      'pending': 'orange'
    };
    return colors[status] || 'default';
  };

  // Get status icon
  const getStatusIcon = (status) => {
    const icons = {
      'processing': <SyncOutlined spin />,
      'completed': <CheckCircleOutlined />,
      'error': <CloseCircleOutlined />,
      'pending': <ClockCircleOutlined />
    };
    return icons[status] || <InfoCircleOutlined />;
  };

  // Currently processing table columns
  const processingColumns = [
    {
      title: 'Position',
      dataIndex: 'position',
      key: 'position',
      width: 80,
      render: (position) => (
        <Tag color="blue">#{position}</Tag>
      )
    },
    {
      title: 'Video',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title, record) => (
        <div>
          <Text strong>{title}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {record.video_id}
          </Text>
        </div>
      )
    },
    {
      title: 'Processing Since',
      dataIndex: 'processing_since',
      key: 'processing_since',
      render: (time) => (
        <div>
          <Text>{new Date(time).toLocaleTimeString()}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {formatDuration(Date.now() - new Date(time).getTime())} ago
          </Text>
        </div>
      )
    },
    {
      title: 'Estimated Completion',
      dataIndex: 'estimated_completion',
      key: 'estimated_completion',
      render: (time) => (
        <Text>{new Date(time).toLocaleTimeString()}</Text>
      )
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_, record) => (
        <div style={{ width: '120px' }}>
          <Progress
            percent={Math.round((record.duration_ms / 60000) * 100)}
            size="small"
            status="active"
            showInfo={false}
          />
          <Text style={{ fontSize: '12px' }}>
            {formatDuration(record.duration_ms)}
          </Text>
        </div>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Button
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={() => loadVideoSteps(record.video_id)}
        >
          Steps
        </Button>
      )
    }
  ];

  // Recently completed table columns
  const completedColumns = [
    {
      title: 'Video',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title, record) => (
        <div>
          <Text strong>{title}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {record.video_id}
          </Text>
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'raw_status',
      key: 'raw_status',
      render: (status) => (
        <Tag color={getStatusColor(status)} icon={getStatusIcon(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Mentions Found',
      dataIndex: 'mentions_found',
      key: 'mentions_found',
      render: (count) => (
        <Statistic
          value={count || 0}
          valueStyle={{ fontSize: '14px' }}
          prefix={<PlayCircleOutlined />}
        />
      )
    },
    {
      title: 'Completed At',
      dataIndex: 'processing_completed_at',
      key: 'processing_completed_at',
      render: (time) => (
        <Text>{new Date(time).toLocaleString()}</Text>
      )
    },
    {
      title: 'Error',
      dataIndex: 'processing_error',
      key: 'processing_error',
      render: (error) => error ? (
        <Tooltip title={error}>
          <Tag color="red">Error</Tag>
        </Tooltip>
      ) : null
    }
  ];

  if (!processingData) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <Spin size="large" />
        <p>Loading processing status...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Header with controls */}
      <Row justify="space-between" align="middle" style={{ marginBottom: '20px' }}>
        <Col>
          <Title level={3}>Video Processing Status</Title>
        </Col>
        <Col>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadProcessingStatus}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              icon={autoRefresh ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => setAutoRefresh(!autoRefresh)}
              type={autoRefresh ? "primary" : "default"}
            >
              {autoRefresh ? 'Pause Auto-refresh' : 'Start Auto-refresh'}
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Statistics Overview */}
      <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Queue Depth"
              value={processingData.statistics.queue_depth}
              prefix={<SyncOutlined spin={processingData.statistics.queue_depth > 0} />}
              valueStyle={{ color: processingData.statistics.queue_depth > 0 ? '#1890ff' : '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Avg Processing Time"
              value={formatDuration(processingData.statistics.avg_processing_time_ms)}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Queue Clear ETA"
              value={processingData.statistics.estimated_queue_clear_time ? 
                new Date(processingData.statistics.estimated_queue_clear_time).toLocaleTimeString() : 'N/A'}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Last Updated"
              value={new Date(processingData.last_updated).toLocaleTimeString()}
              prefix={<InfoCircleOutlined />}
              valueStyle={{ color: '#666' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Currently Processing Videos */}
      <Card title="Currently Processing" style={{ marginBottom: '20px' }}>
        {processingData.currently_processing.length === 0 ? (
          <Alert
            message="No videos currently being processed"
            description="The processing queue is empty. Videos will appear here when processing is started."
            type="info"
            showIcon
          />
        ) : (
          <Table
            columns={processingColumns}
            dataSource={processingData.currently_processing}
            pagination={false}
            rowKey="video_id"
            size="small"
          />
        )}
      </Card>

      {/* Recently Completed Videos */}
      <Card title="Recently Completed">
        <Table
          columns={completedColumns}
          dataSource={processingData.recently_completed}
          pagination={false}
          rowKey="video_id"
          size="small"
        />
      </Card>

      {/* Video Steps Modal */}
      <Modal
        title={`Processing Steps - ${videoSteps?.video?.title || 'Video'}`}
        visible={stepsModalVisible}
        onCancel={() => setStepsModalVisible(false)}
        footer={null}
        width={700}
      >
        {videoSteps && (
          <div>
            {/* Progress Overview */}
            <Card style={{ marginBottom: '16px' }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic
                    title="Overall Progress"
                    value={videoSteps.progress.percentage}
                    suffix="%"
                    prefix={<SyncOutlined spin={videoSteps.progress.percentage < 100} />}
                  />
                  <Progress percent={videoSteps.progress.percentage} />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="Time Remaining"
                    value={formatDuration(videoSteps.progress.estimated_time_remaining_ms)}
                    prefix={<ClockCircleOutlined />}
                  />
                </Col>
              </Row>
            </Card>

            {/* Processing Steps Timeline */}
            <Timeline>
              {videoSteps.steps.map((step, index) => (
                <Timeline.Item
                  key={step.step}
                  color={getStatusColor(step.status)}
                  icon={getStatusIcon(step.status)}
                >
                  <div>
                    <Text strong>{step.name}</Text>
                    <Tag color={getStatusColor(step.status)} style={{ marginLeft: '8px' }}>
                      {step.status.toUpperCase()}
                    </Tag>
                    <br />
                    <Text type="secondary">{step.description}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Estimated duration: {formatDuration(step.estimated_duration)}
                    </Text>
                  </div>
                </Timeline.Item>
              ))}
            </Timeline>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProcessingStatusTab;
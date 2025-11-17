#!/bin/bash

# Start Services for YouTube RSS Mention Detection System
# This script starts all external services required for real mention processing

set -e

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$BASE_DIR/logs"

# Create logs directory
mkdir -p "$LOG_DIR"

echo "🚀 Starting YouTube RSS Mention Detection Services..."
echo "📁 Base directory: $BASE_DIR"
echo "📝 Logs directory: $LOG_DIR"

# Function to check if python3 is available
check_python() {
    if command -v python3 &> /dev/null; then
        echo "✅ Python3 found: $(python3 --version)"
        return 0
    else
        echo "❌ Python3 not found. Please install Python 3.7+"
        return 1
    fi
}

# Function to install requirements for a service
install_requirements() {
    local service_dir="$1"
    local service_name="$2"
    
    echo "📦 Installing requirements for $service_name..."
    
    if [ -f "$service_dir/requirements.txt" ]; then
        cd "$service_dir"
        
        # Create virtual environment if it doesn't exist
        if [ ! -d "venv" ]; then
            echo "🔧 Creating virtual environment for $service_name..."
            python3 -m venv venv
        fi
        
        # Activate virtual environment and install requirements
        source venv/bin/activate
        pip install --upgrade pip
        pip install -r requirements.txt
        deactivate
        
        echo "✅ Requirements installed for $service_name"
    else
        echo "⚠️ No requirements.txt found for $service_name"
    fi
}

# Function to start a service
start_service() {
    local service_dir="$1"
    local service_name="$2"
    local port="$3"
    
    echo "🔄 Starting $service_name on port $port..."
    
    cd "$service_dir"
    
    # Check if virtual environment exists
    if [ ! -d "venv" ]; then
        echo "❌ Virtual environment not found for $service_name"
        return 1
    fi
    
    # Start service in background
    source venv/bin/activate
    export PORT="$port"
    nohup python3 app.py > "$LOG_DIR/$service_name.log" 2>&1 &
    local pid=$!
    echo $pid > "$LOG_DIR/$service_name.pid"
    deactivate
    
    # Wait a moment and check if service started
    sleep 2
    if kill -0 $pid 2>/dev/null; then
        echo "✅ $service_name started successfully (PID: $pid, Port: $port)"
        
        # Test the health endpoint
        sleep 1
        if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
            echo "🟢 $service_name health check passed"
        else
            echo "🟡 $service_name started but health check failed (may need more time to initialize)"
        fi
    else
        echo "❌ Failed to start $service_name"
        return 1
    fi
}

# Function to stop all services
stop_services() {
    echo "🛑 Stopping all services..."
    
    for pidfile in "$LOG_DIR"/*.pid; do
        if [ -f "$pidfile" ]; then
            local service_name=$(basename "$pidfile" .pid)
            local pid=$(cat "$pidfile")
            
            if kill -0 "$pid" 2>/dev/null; then
                echo "🔄 Stopping $service_name (PID: $pid)..."
                kill "$pid"
                
                # Wait for graceful shutdown
                local count=0
                while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
                    sleep 1
                    count=$((count + 1))
                done
                
                # Force kill if still running
                if kill -0 "$pid" 2>/dev/null; then
                    echo "⚡ Force killing $service_name..."
                    kill -9 "$pid"
                fi
                
                echo "✅ Stopped $service_name"
            fi
            
            rm -f "$pidfile"
        fi
    done
}

# Function to check service status
check_services() {
    echo "🔍 Checking service status..."
    echo
    
    local services=(
        "transcript-service:8001"
        "mention-detection:8002"
        "llama-service:8080"
    )
    
    for service_info in "${services[@]}"; do
        local service_name="${service_info%:*}"
        local port="${service_info#*:}"
        local pidfile="$LOG_DIR/$service_name.pid"
        
        echo -n "📊 $service_name (port $port): "
        
        if [ -f "$pidfile" ]; then
            local pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
                    echo "🟢 Running (PID: $pid)"
                else
                    echo "🟡 Process running but not responding (PID: $pid)"
                fi
            else
                echo "🔴 Not running (stale PID file)"
                rm -f "$pidfile"
            fi
        else
            echo "🔴 Not running"
        fi
    done
    
    echo
}

# Function to show logs
show_logs() {
    local service_name="$1"
    local log_file="$LOG_DIR/$service_name.log"
    
    if [ -f "$log_file" ]; then
        echo "📋 Showing logs for $service_name:"
        echo "================================"
        tail -f "$log_file"
    else
        echo "❌ Log file not found for $service_name"
        echo "Available logs:"
        ls -la "$LOG_DIR"/*.log 2>/dev/null || echo "No log files found"
    fi
}

# Main execution
case "${1:-start}" in
    "start")
        # Check dependencies
        check_python || exit 1
        
        # Install requirements for all services
        install_requirements "$BASE_DIR/transcript-service" "transcript-service"
        install_requirements "$BASE_DIR/mention-detection" "mention-detection"
        install_requirements "$BASE_DIR/llama-service" "llama-service"
        
        echo
        echo "🚀 Starting all services..."
        
        # Start services
        start_service "$BASE_DIR/transcript-service" "transcript-service" "8001"
        start_service "$BASE_DIR/mention-detection" "mention-detection" "8002"
        start_service "$BASE_DIR/llama-service" "llama-service" "8080"
        
        echo
        echo "🎉 All services started successfully!"
        echo
        echo "Service URLs:"
        echo "  📝 Transcript Service:    http://localhost:8001/health"
        echo "  🔍 Mention Detection:     http://localhost:8002/health"
        echo "  🧠 Llama Service:         http://localhost:8080/health"
        echo
        echo "View logs: $0 logs <service-name>"
        echo "Check status: $0 status"
        echo "Stop services: $0 stop"
        ;;
        
    "stop")
        stop_services
        echo "✅ All services stopped"
        ;;
        
    "restart")
        stop_services
        sleep 2
        $0 start
        ;;
        
    "status")
        check_services
        ;;
        
    "logs")
        if [ -z "$2" ]; then
            echo "Usage: $0 logs <service-name>"
            echo "Available services: transcript-service, mention-detection, llama-service"
        else
            show_logs "$2"
        fi
        ;;
        
    "test")
        echo "🧪 Testing all services..."
        echo
        
        # Test transcript service
        echo "📝 Testing transcript service..."
        curl -s -X POST http://localhost:8001/extract \
             -H "Content-Type: application/json" \
             -d '{"video_id":"dQw4w9WgXcQ","languages":["en"]}' | jq .success
        
        # Test mention detection
        echo "🔍 Testing mention detection..."
        curl -s -X POST http://localhost:8002/detect \
             -H "Content-Type: application/json" \
             -d '{"video_id":"test","segments":[{"text":"Modi government announcement","start_time":0,"duration":2}],"keywords":[{"text":"Modi","weight":1.0}]}' | jq .success
        
        # Test llama service
        echo "🧠 Testing llama service..."
        curl -s -X POST http://localhost:8080/completion \
             -H "Content-Type: application/json" \
             -d '{"prompt":"Test prompt"}' | jq .content
        
        echo "✅ Service tests completed"
        ;;
        
    "help"|"--help"|"-h")
        echo "YouTube RSS Mention Detection - Service Manager"
        echo
        echo "Usage: $0 [command]"
        echo
        echo "Commands:"
        echo "  start     Start all services (default)"
        echo "  stop      Stop all services"
        echo "  restart   Restart all services"
        echo "  status    Check service status"
        echo "  logs      Show logs for a service"
        echo "  test      Test all services"
        echo "  help      Show this help message"
        echo
        echo "Examples:"
        echo "  $0                              # Start all services"
        echo "  $0 status                       # Check status"
        echo "  $0 logs transcript-service      # View transcript service logs"
        echo "  $0 stop                         # Stop all services"
        ;;
        
    *)
        echo "❌ Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
"""Tests for core/monitor.py"""

import asyncio
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import pynvml
import psutil


class TestGPUMonitorInit:
    @patch('pynvml.nvmlInit')
    @patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.129.03')
    @patch('pynvml.nvmlDeviceGetCount', return_value=1)
    @patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock())
    def test_init_success(self, mock_handle, mock_count, mock_version, mock_init):
        with patch('core.metrics.collector.MetricsCollector.collect_all',
                   return_value={'name': 'RTX 3090', 'utilization': 75}):
            from core.monitor import GPUMonitor
            monitor = GPUMonitor()

        assert monitor.initialized is True
        mock_init.assert_called_once()

    @patch('pynvml.nvmlInit', side_effect=Exception("No NVIDIA driver"))
    def test_init_failure(self, mock_init):
        from core.monitor import GPUMonitor
        monitor = GPUMonitor()
        assert monitor.initialized is False


class TestDetectSmiGpus:
    @patch('pynvml.nvmlInit')
    @patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0')
    @patch('pynvml.nvmlDeviceGetCount', return_value=2)
    @patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock())
    def test_all_nvml(self, mock_handle, mock_count, mock_version, mock_init):
        with patch('core.metrics.collector.MetricsCollector.collect_all',
                   return_value={'name': 'RTX 3090', 'utilization': 75}):
            from core.monitor import GPUMonitor
            monitor = GPUMonitor()

        assert monitor.use_smi.get('0') is False
        assert monitor.use_smi.get('1') is False

    @patch('pynvml.nvmlInit')
    @patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0')
    @patch('pynvml.nvmlDeviceGetCount', return_value=2)
    @patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock())
    def test_mixed_gpus(self, mock_handle, mock_count, mock_version, mock_init):
        call_count = [0]

        def collect_side_effect(handle, gpu_id):
            call_count[0] += 1
            if gpu_id == '0':
                return {'name': 'RTX 3090', 'utilization': 75}
            else:
                return {'name': 'GTX 750', 'utilization': None}

        with patch('core.metrics.collector.MetricsCollector.collect_all',
                   side_effect=collect_side_effect):
            from core.monitor import GPUMonitor
            monitor = GPUMonitor()

        assert monitor.use_smi.get('0') is False
        assert monitor.use_smi.get('1') is True

    @patch('pynvml.nvmlInit')
    @patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0')
    @patch('pynvml.nvmlDeviceGetCount', return_value=1)
    @patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock())
    @patch('core.monitor.NVIDIA_SMI', True)
    def test_forced_smi(self, mock_handle, mock_count, mock_version, mock_init):
        with patch('core.metrics.collector.MetricsCollector.collect_all',
                   return_value={'name': 'RTX 3090', 'utilization': 75}):
            from core.monitor import GPUMonitor
            monitor = GPUMonitor()

        assert monitor.use_smi.get('0') is True


class TestGetGpuData:
    @pytest.mark.asyncio
    async def test_not_initialized(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit', side_effect=Exception("no driver")):
            monitor = GPUMonitor()
        data = await monitor.get_gpu_data()
        assert data == {}

    @pytest.mark.asyncio
    async def test_nvml_path(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit'), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0'), \
             patch('pynvml.nvmlDeviceGetCount', return_value=1), \
             patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock()):

            with patch('core.metrics.collector.MetricsCollector.collect_all',
                       return_value={'name': 'RTX 3090', 'utilization': 75}):
                monitor = GPUMonitor()

            # Now test get_gpu_data
            with patch('pynvml.nvmlDeviceGetCount', return_value=1), \
                 patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock()):
                with patch.object(monitor, '_collect_single_gpu',
                                  return_value={'name': 'RTX 3090', 'utilization': 80}):
                    data = await monitor.get_gpu_data()

            assert '0' in data
            assert data['0']['utilization'] == 80

    @pytest.mark.asyncio
    async def test_smi_path(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit'), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0'), \
             patch('pynvml.nvmlDeviceGetCount', return_value=1), \
             patch('pynvml.nvmlDeviceGetHandleByIndex', return_value=MagicMock()):

            with patch('core.metrics.collector.MetricsCollector.collect_all',
                       return_value={'name': 'GTX 750'}):
                monitor = GPUMonitor()

            assert monitor.use_smi.get('0') is True

            smi_result = {'0': {'name': 'GTX 750', 'utilization': 60}}
            with patch('pynvml.nvmlDeviceGetCount', return_value=1), \
                 patch('core.monitor.parse_nvidia_smi', return_value=smi_result):
                data = await monitor.get_gpu_data()

            assert '0' in data
            assert data['0']['name'] == 'GTX 750'


class TestGetProcessName:
    def _make_monitor(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit'), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0'), \
             patch('pynvml.nvmlDeviceGetCount', return_value=0):
            monitor = GPUMonitor()
        return monitor

    def test_nvml_record_includes_model_when_pid_command_is_known(self):
        monitor = self._make_monitor()
        running = MagicMock(pid=696825, usedGpuMemory=1024 * 1024)
        process = MagicMock()
        process.name.return_value = 'llama-server'
        process.cmdline.return_value = [
            '/opt/llama.cpp-new/build/bin/llama-server', '-m', '/opt/models/Qwen3.8-27B-UD-Q4_K_XL.gguf',
            '--alias', 'qwen38-q4'
        ]
        with patch('pynvml.nvmlDeviceGetCount', return_value=2), \
             patch('pynvml.nvmlDeviceGetHandleByIndex'), \
             patch('pynvml.nvmlDeviceGetUUID', return_value='GPU-test'), \
             patch('pynvml.nvmlDeviceGetComputeRunningProcesses', return_value=[running]), \
             patch('psutil.Process', return_value=process):
            records = monitor._get_processes_sync()
        assert [(record['gpu_id'], record['model']) for record in records] == [
            ('0', 'qwen38-q4'), ('1', 'qwen38-q4')
        ]

    def test_nvml_ollama_record_uses_reported_gpu_memory(self, tmp_path, monkeypatch):
        monkeypatch.setenv('OLLAMA_MODELS', str(tmp_path))
        monkeypatch.setenv('GPU_HOT_OLLAMA_API', 'http://ollama-nvml-test')
        monitor = self._make_monitor()
        running = MagicMock(pid=696825, usedGpuMemory=16 * 1024 ** 3)
        process = MagicMock()
        process.name.return_value = 'llama-server'
        process.cmdline.return_value = [
            '/usr/lib/ollama/llama-server', '--model',
            '/root/.ollama/models/blobs/sha256-e7b273f9636059a689e3ddcab3716e4f65abe0143ac978e46673ad0e52d09efb'
        ]
        response = MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = json.dumps({'models': [
            {'name': 'gpt-oss-32k:latest', 'digest': 'first', 'size_vram': 16 * 1024 ** 3},
            {'name': 'gemma3', 'digest': 'second', 'size_vram': 5 * 1024 ** 3},
        ]}).encode()
        with patch('pynvml.nvmlDeviceGetCount', return_value=1), \
             patch('pynvml.nvmlDeviceGetHandleByIndex'), \
             patch('pynvml.nvmlDeviceGetUUID', return_value='GPU-test'), \
             patch('pynvml.nvmlDeviceGetComputeRunningProcesses', return_value=[running]), \
             patch('psutil.Process', return_value=process), \
             patch('core.process_models.request.urlopen', return_value=response):
            records = monitor._get_processes_sync()
        assert records[0]['model'] == 'gpt-oss-32k:latest'

    @patch('psutil.Process')
    def test_normal_process(self, mock_process_cls):
        monitor = self._make_monitor()
        proc = MagicMock()
        proc.name.return_value = 'blender'
        mock_process_cls.return_value = proc

        assert monitor._get_process_name(1234) == 'blender'

    @patch('psutil.Process')
    def test_python_process_with_script(self, mock_process_cls):
        monitor = self._make_monitor()
        proc = MagicMock()
        proc.name.return_value = 'python3'
        proc.cmdline.return_value = ['python3', '/home/user/train.py', '--epochs', '100']
        mock_process_cls.return_value = proc

        assert monitor._get_process_name(1234) == 'train.py'

    @patch('psutil.Process')
    def test_python_with_module(self, mock_process_cls):
        monitor = self._make_monitor()
        proc = MagicMock()
        proc.name.return_value = 'python3'
        proc.cmdline.return_value = ['python3', '-m', 'torch.distributed.launch']
        mock_process_cls.return_value = proc

        result = monitor._get_process_name(1234)
        assert result == 'torch.distributed.launch'

    @patch('psutil.Process', side_effect=psutil.NoSuchProcess(pid=9999))
    def test_no_such_process(self, mock_process_cls):
        monitor = self._make_monitor()
        assert monitor._get_process_name(9999) == 'PID:9999'


class TestShutdown:
    @pytest.mark.asyncio
    async def test_shutdown(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit'), \
             patch('pynvml.nvmlSystemGetDriverVersion', return_value=b'535.0'), \
             patch('pynvml.nvmlDeviceGetCount', return_value=0):
            monitor = GPUMonitor()

        with patch('pynvml.nvmlShutdown') as mock_shutdown:
            await monitor.shutdown()
            mock_shutdown.assert_called_once()
            assert monitor.initialized is False

    @pytest.mark.asyncio
    async def test_shutdown_not_initialized(self):
        from core.monitor import GPUMonitor
        with patch('pynvml.nvmlInit', side_effect=Exception("fail")):
            monitor = GPUMonitor()

        with patch('pynvml.nvmlShutdown') as mock_shutdown:
            await monitor.shutdown()
            mock_shutdown.assert_not_called()

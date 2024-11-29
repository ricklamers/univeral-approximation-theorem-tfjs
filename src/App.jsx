import { useState, useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import './App.css';

const DEBUG = false;  // Global debug flag

function App() {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [model, setModel] = useState(null);
  const [isTraining, setIsTraining] = useState(false);
  const [predictionLine, setPredictionLine] = useState([]);
  const [stats, setStats] = useState({ 
    loss: null, 
    iterations: 0, 
    epochTime: null,
    learningRate: 0.002,  // Initial learning rate
    samplingFactor: 4  // Default sampling factor
  });
  const [canStartTraining, setCanStartTraining] = useState(false);
  const [changedStats, setChangedStats] = useState({ 
    loss: false, 
    iterations: false, 
    epochTime: false,
    learningRate: false,
    samplingFactor: false
  });
  
  // Refs for handling async state updates
  const isDrawingRef = useRef(false);
  const pointsRef = useRef([]);
  const isTrainingRef = useRef(false);
  const optimizerRef = useRef(null);
  
  const canvasWidth = 600;
  const canvasHeight = 400;
  const padding = 40;
  const tickSize = 5;
  const dpr = window.devicePixelRatio || 1;  // Get device pixel ratio

  // Learning rate adjustment function
  const getAdaptiveLearningRate = (currentLoss) => {
    if (currentLoss === null) return 0.002;  // Initial learning rate
    
    // More aggressive decay based on loss
    if (currentLoss < 0.0001) return 0.00001;  // Very fine-tuning
    if (currentLoss < 0.001) return 0.0001;   // Fine-tuning
    if (currentLoss < 0.01) return 0.0005;    // Medium steps
    if (currentLoss < 0.1) return 0.001;      // Larger steps
    return 0.002;                             // Initial steps
  };

  useEffect(() => {
    const initTensorFlow = async () => {
      // Set backend to WebGL for GPU acceleration
      await tf.setBackend('webgl');
      
      // Configure WebGL backend for better performance
      const backend = tf.backend();
      if (backend.name === 'webgl') {
        // Enable float textures for better precision
        backend.setFlags({
          'WEBGL_FORCE_F16_TEXTURES': false,
          'WEBGL_PACK': true,
          'WEBGL_CHECK_NUMERICAL_PROBLEMS': false,
          'WEBGL_BUFFER_SUPPORTED': true
        });
        
        // Increase maximum texture size if device supports it
        const maxTextureSize = backend.getMaxTextureSize();
        backend.setFlags({
          'WEBGL_MAX_TEXTURE_SIZE': maxTextureSize,
          'WEBGL_MAX_TEXTURES_IN_SHADER': 16
        });
      }
      
      // Enable tensor memory tracking in debug mode
      if (DEBUG) {
        tf.enableDebugMode();
        console.log('TensorFlow.js memory:', tf.memory());
      }
      
      // Create the model after backend is initialized
      setModel(createModel());
    };
    
    initTensorFlow();
    
    // Cleanup function
    return () => {
      // Dispose of any remaining tensors
      tf.disposeVariables();
    };
  }, []);

  const createModel = () => {
    if (DEBUG) console.log('TensorFlow.js version:', tf.version);
    if (DEBUG) console.log('TensorFlow.js backend:', tf.getBackend());
    
    let neuralNetwork;
    
    // First hidden layer - wider for better feature capture
    const input = tf.input({shape: [1]});
    let x = tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(input);
    
    // Second hidden layer with skip connection
    const layer2 = tf.layers.dense({
      units: 64,
      activation: 'tanh',  // Mix different activation functions
      kernelInitializer: 'heNormal'
    }).apply(x);
    x = tf.layers.add().apply([x, layer2]);  // Skip connection
    
    // Third hidden layer
    x = tf.layers.dense({
      units: 64,
      activation: 'sigmoid',  // Different activation for more expressiveness
      kernelInitializer: 'heNormal'
    }).apply(x);
    
    // Fourth hidden layer with skip connection
    const layer4 = tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(x);
    x = tf.layers.add().apply([x, layer4]);  // Skip connection
    
    // Fifth hidden layer for fine details
    x = tf.layers.dense({
      units: 32,
      activation: 'tanh',
      kernelInitializer: 'heNormal'
    }).apply(x);
    
    // Output layer
    const output = tf.layers.dense({
      units: 1,
      kernelInitializer: 'heNormal'
    }).apply(x);
    
    // Create model with functional API
    neuralNetwork = tf.model({inputs: input, outputs: output});
    
    // Create optimizer with better parameters
    optimizerRef.current = tf.train.adamax(0.002);  // Adamax tends to be more stable
    
    neuralNetwork.compile({
      optimizer: optimizerRef.current,
      loss: 'meanSquaredError'
    });

    if (DEBUG) console.log('Model created:', neuralNetwork);
    neuralNetwork.summary();
    return neuralNetwork;
  };

  const updateOptimizer = (loss) => {
    const newLR = getAdaptiveLearningRate(loss);
    if (newLR !== stats.learningRate) {
      if (DEBUG) console.log('Updating learning rate:', { oldLR: stats.learningRate, newLR, loss });
      optimizerRef.current = tf.train.adamax(newLR);  // Adamax tends to be more stable
      model.compile({
        optimizer: optimizerRef.current,
        loss: 'meanSquaredError'
      });
      setStats(prev => ({ ...prev, learningRate: newLR }));
      setChangedStats(prev => ({ ...prev, learningRate: true }));
    }
  };

  const samplePoints = (points, factor) => {
    if (!points.length) return [];
    if (factor <= 1) return points;

    // Sort points by x coordinate
    const sortedPoints = [...points].sort((a, b) => a.x - b.x);
    
    // Always include first and last points
    const sampledPoints = [sortedPoints[0]];
    
    // Sample intermediate points
    for (let i = 1; i < sortedPoints.length - 1; i += factor) {
      sampledPoints.push(sortedPoints[i]);
    }
    
    // Add last point if not already included
    if (sampledPoints[sampledPoints.length - 1] !== sortedPoints[sortedPoints.length - 1]) {
      sampledPoints.push(sortedPoints[sortedPoints.length - 1]);
    }
    
    return sampledPoints;
  };

  const trainModel = async () => {
    if (DEBUG) console.log('Starting training...', { points: pointsRef.current });
    if (!model || pointsRef.current.length < 2) {
      if (DEBUG) console.log('Cannot train:', { model: !!model, pointsLength: pointsRef.current.length });
      return;
    }

    isTrainingRef.current = true;
    setIsTraining(true);
    setStats(prev => ({ 
      ...prev, 
      iterations: 0,
      learningRate: 0.002  // Reset learning rate on new training
    }));

    if (DEBUG) console.log('Creating tensors...');
    
    // Sample the points before training
    const sampledPoints = samplePoints(pointsRef.current, stats.samplingFactor);
    if (DEBUG) console.log('Sampled points:', { original: pointsRef.current.length, sampled: sampledPoints.length });
    
    // Use sampled points for training
    const xValues = sampledPoints.map(p => p.x);
    const yValues = sampledPoints.map(p => p.y);
    
    // Create tensors with normalized data
    const xs = tf.tensor2d(xValues, [sampledPoints.length, 1]);
    const ys = tf.tensor2d(yValues, [sampledPoints.length, 1]);
    
    if (DEBUG) console.log('Tensors created:', { xs, ys });

    // Constants for prediction visualization
    const NUM_PREDICTIONS = 400;
    const X_RANGE = 10;
    
    // Generate evenly spaced x values once
    const xPredict = tf.linspace(0, X_RANGE, NUM_PREDICTIONS);
    
    const updatePredictions = async () => {
      if (!isTrainingRef.current) return;
      
      // Use tidy to automatically cleanup intermediate tensors
      tf.tidy(() => {
        try {
          if (DEBUG) console.log('Updating predictions...');
          const predictions = model.predict(xPredict.reshape([NUM_PREDICTIONS, 1]));
          const predPoints = Array.from(predictions.dataSync()).map((y, i) => ({
            x: (i * X_RANGE) / (NUM_PREDICTIONS - 1),
            y: y
          }));
          setPredictionLine(predPoints);
        } catch (error) {
          console.error('Error updating predictions:', error);
        }
      });
    };

    const trainLoop = async () => {
      if (DEBUG) console.log('Train loop starting...', { isTrainingRef: isTrainingRef.current });
      if (!isTrainingRef.current) {
        if (DEBUG) console.log('Training stopped, cleaning up...');
        xs.dispose();
        ys.dispose();
        xPredict.dispose();
        return;
      }
      
      const startTime = performance.now();
      
      try {
        if (DEBUG) console.log('Starting model.fit...');
        // Enable async training for better UI responsiveness
        const result = await model.fit(xs, ys, {
          epochs: 20,  // Increased epochs per iteration for better convergence
          batchSize: Math.min(16, sampledPoints.length),  // Smaller batch size for more updates
          shuffle: true,
          yieldEvery: 'never',  // Disable yielding for faster training
          callbacks: {
            onBatchBegin: async (batch) => {
              if (!isTrainingRef.current) return false;
              if (DEBUG) console.log('Batch starting:', batch);
            },
            onBatchEnd: async (batch, logs) => {
              if (!isTrainingRef.current) return false;
              if (DEBUG) console.log('Batch ended:', batch, 'Loss:', logs.loss);
            },
            onEpochBegin: async (epoch) => {
              if (!isTrainingRef.current) return false;
              if (DEBUG) console.log('Epoch starting:', epoch);
            },
            onEpochEnd: async (epoch, logs) => {
              if (!isTrainingRef.current) return false;
              if (DEBUG) console.log('Epoch ended:', epoch, 'Loss:', logs.loss);
              const endTime = performance.now();
              const epochTime = ((endTime - startTime) / 1000).toFixed(3);
              const newLoss = logs.loss.toFixed(6);
              
              // Update learning rate based on current loss
              updateOptimizer(logs.loss);
              
              setStats(prev => ({
                loss: newLoss,
                iterations: prev.iterations + 1,
                epochTime,
                learningRate: prev.learningRate,
                samplingFactor: prev.samplingFactor
              }));

              setChangedStats({
                loss: true,
                iterations: true,
                epochTime: true,
                learningRate: true,
                samplingFactor: true
              });

              await updatePredictions();
              if (isTrainingRef.current) {
                drawCanvas();
              }
            }
          }
        });
        
        if (DEBUG) console.log('model.fit completed:', result);

        if (isTrainingRef.current) {
          trainLoop();  // Continue training without animation frame
        }
      } catch (error) {
        console.error('Training error:', error);
        isTrainingRef.current = false;
        setIsTraining(false);
      }
    };

    if (DEBUG) console.log('Starting initial train loop...');
    await trainLoop();
  };

  useEffect(() => {
    setCanStartTraining(pointsRef.current.length >= 2);
  }, [pointsRef]);

  useEffect(() => {
    drawCanvas();
  }, [points, predictionLine]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set up high-DPI canvas
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw grid with lighter color
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    
    // Draw grid lines
    for (let x = 0; x <= 10; x++) {
      const xPos = padding + (x * (canvasWidth - 2 * padding) / 10);
      ctx.beginPath();
      ctx.moveTo(xPos, padding);
      ctx.lineTo(xPos, canvasHeight - padding);
      ctx.stroke();
    }
    
    for (let y = 0; y <= 10; y++) {
      const yPos = canvasHeight - padding - (y * (canvasHeight - 2 * padding) / 10);
      ctx.beginPath();
      ctx.moveTo(padding, yPos);
      ctx.lineTo(canvasWidth - padding, yPos);
      ctx.stroke();
    }
    
    // Draw axes with darker color
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    
    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvasHeight - padding);
    ctx.stroke();
    
    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, canvasHeight - padding);
    ctx.lineTo(canvasWidth - padding, canvasHeight - padding);
    ctx.stroke();

    // Draw ticks and labels
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px sans-serif';
    
    // X axis ticks and labels
    for (let x = 0; x <= 10; x++) {
      const xPos = padding + (x * (canvasWidth - 2 * padding) / 10);
      ctx.beginPath();
      ctx.moveTo(xPos, canvasHeight - padding - tickSize);
      ctx.lineTo(xPos, canvasHeight - padding + tickSize);
      ctx.stroke();
      ctx.fillText(x.toString(), xPos, canvasHeight - padding + 20);
    }
    
    // Y axis ticks and labels
    for (let y = 0; y <= 10; y++) {
      const yPos = canvasHeight - padding - (y * (canvasHeight - 2 * padding) / 10);
      ctx.beginPath();
      ctx.moveTo(padding - tickSize, yPos);
      ctx.lineTo(padding + tickSize, yPos);
      ctx.stroke();
      ctx.fillText(y.toString(), padding - 20, yPos);
    }

    // Draw function line
    if (points.length > 0) {
      const sortedPoints = [...points].sort((a, b) => a.x - b.x);
      
      ctx.beginPath();
      ctx.strokeStyle = '#3b82f6';  // Modern blue
      ctx.lineWidth = 3;
      
      sortedPoints.forEach((point, index) => {
        const x = padding + (point.x * (canvasWidth - 2 * padding) / 10);
        const y = canvasHeight - padding - (point.y * (canvasHeight - 2 * padding) / 10);
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    // Draw neural network prediction line
    if (predictionLine.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#dc2626';  // Modern red
      ctx.lineWidth = 2;
      
      predictionLine.forEach((point, index) => {
        const x = padding + (point.x * (canvasWidth - 2 * padding) / 10);
        const y = canvasHeight - padding - (point.y * (canvasHeight - 2 * padding) / 10);
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }
  };

  const getCanvasCoordinates = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left - padding) / (canvasWidth - 2 * padding)) * 10;
    const y = (1 - (e.clientY - rect.top - padding) / (canvasHeight - 2 * padding)) * 10;
    return { x: Math.max(0, Math.min(10, x)), y: Math.max(0, Math.min(10, y)) };
  };

  const handleMouseDown = (e) => {
    if (DEBUG) console.log('Mouse down, starting new drawing...');
    isDrawingRef.current = true;
    setIsDrawing(true);
    
    isTrainingRef.current = false;  // Stop any existing training
    setIsTraining(false);
    setPredictionLine([]); // Clear previous predictions
    
    const coords = getCanvasCoordinates(e);
    pointsRef.current = [coords];
    setPoints([coords]);
  };

  const handleMouseMove = (e) => {
    if (!isDrawingRef.current) return;
    
    const coords = getCanvasCoordinates(e);
    pointsRef.current = [...pointsRef.current, coords];
    setPoints(prev => [...prev, coords]);
  };

  const handleMouseUp = () => {
    if (isDrawingRef.current) {
      if (DEBUG) console.log('Mouse up, finished drawing');
      isDrawingRef.current = false;
      setIsDrawing(false);
      setCanStartTraining(pointsRef.current.length >= 2);
    }
  };

  const toggleTraining = () => {
    if (DEBUG) console.log('Toggle training clicked:', { 
      isTraining, 
      isTrainingRef: isTrainingRef.current,
      pointsLength: pointsRef.current.length 
    });
    
    if (!isTrainingRef.current && pointsRef.current.length >= 2) {
      trainModel();
    } else {
      isTrainingRef.current = false;
      setIsTraining(false);
    }
  };

  // Update refs when state changes
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  useEffect(() => {
    isTrainingRef.current = isTraining;
  }, [isTraining]);

  return (
    <div className="app-container">
      <h1>Universal Approximation Theorem Demo</h1>
      <div className="stats-container">
        <div className={`stat-box ${isTraining ? 'active' : ''}`}>
          <span className="stat-label">Loss:</span>
          <span className={`stat-value ${changedStats.loss ? 'changed' : ''}`}>
            {stats.loss || 'N/A'}
          </span>
        </div>
        <div className={`stat-box ${isTraining ? 'active' : ''}`}>
          <span className="stat-label">Learning Rate:</span>
          <span className={`stat-value ${changedStats.learningRate ? 'changed' : ''}`}>
            {stats.learningRate?.toExponential(2) || 'N/A'}
          </span>
        </div>
        <div className={`stat-box ${isTraining ? 'active' : ''}`}>
          <span className="stat-label">Iterations:</span>
          <span className={`stat-value ${changedStats.iterations ? 'changed' : ''}`}>
            {stats.iterations}
          </span>
        </div>
        <div className={`stat-box ${isTraining ? 'active' : ''}`}>
          <span className="stat-label">Epoch Time:</span>
          <span className={`stat-value ${changedStats.epochTime ? 'changed' : ''}`}>
            {stats.epochTime ? `${stats.epochTime}s` : 'N/A'}
          </span>
        </div>
        <div className={`stat-box ${isTraining ? 'active' : ''}`}>
          <span className="stat-label">Sampling Factor:</span>
          <span className={`stat-value ${changedStats.samplingFactor ? 'changed' : ''}`}>
            {stats.samplingFactor}
          </span>
        </div>
        <button 
          className={`control-button ${!isTraining ? 'start' : ''} ${isTraining ? 'training' : ''}`}
          onClick={toggleTraining}
          disabled={!isTraining && !canStartTraining}
        >
          {isTraining ? 'Stop Training' : 'Start Training'}
        </button>
      </div>
      <div className="canvas-container">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
      <div className="points-table">
        <h3>Points Data ({points.length} points)</h3>
        <div className="table-container">
          {points.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>X</th>
                  <th>Y</th>
                </tr>
              </thead>
              <tbody>
                {[...points]
                  .sort((a, b) => a.x - b.x)
                  .map((point, index) => (
                    <tr key={index}>
                      <td>{point.x.toFixed(2)}</td>
                      <td>{point.y.toFixed(2)}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              Draw on the canvas to add points
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;

# Universal Approximation Theorem Visualization

An interactive visualization of the Universal Approximation Theorem using TensorFlow.js. This web application demonstrates how neural networks can approximate any continuous function, given enough neurons in a single hidden layer.

 [Live Demo](https://ricklamers.github.io/univeral-approximation-theorem-tfjs/)

 
<img width="500" alt="Screenshot 2024-11-29 at 2 08 16 PM" src="https://github.com/user-attachments/assets/2e3162ad-863d-40ad-bad3-fb2ef550c845">

## Overview

The Universal Approximation Theorem is a fundamental result in neural network theory. It states that a feedforward neural network with a single hidden layer containing a finite number of neurons can approximate any continuous function on compact subsets of ℝⁿ, under mild assumptions about the activation function.

This visualization allows you to:
- Interactively draw any continuous function
- Watch a neural network learn to approximate your drawn function
- Adjust network parameters in real-time
- Visualize the learning process

## Technology Stack

- React + Vite for the frontend framework
- TensorFlow.js for neural network implementation
- GitHub Actions for automated deployment
- GitHub Pages for hosting

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/ricklamers/univeral-approximation-theorem-tfjs.git
cd univeral-approximation-theorem-tfjs
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Deployment

The project is automatically deployed to GitHub Pages using GitHub Actions. Any push to the main branch will trigger a new deployment, or you can manually trigger it from the Actions tab in the repository.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

MIT License - feel free to use this code for your own projects or educational purposes.

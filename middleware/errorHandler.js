const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error for development
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = {
      success: false,
      error: message,
      statusCode: 400
    };
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    error = {
      success: false,
      error: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`,
      statusCode: 400
    };
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error = {
      success: false,
      error: 'Resource not found',
      statusCode: 404
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      success: false,
      error: 'Invalid token',
      statusCode: 401
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      success: false,
      error: 'Token expired',
      statusCode: 401
    };
  }

  // Default error
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.error || 'Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};

module.exports = errorHandler;

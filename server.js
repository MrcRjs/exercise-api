const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const logger = require('morgan')

const cors = require('cors')

const mongoose = require('mongoose')
mongoose.connect(process.env.MLAB_URI || 'mongodb://localhost/exercise-track', { useMongoClient: true })

const ExerciseSchema = new mongoose.Schema({
  userId: String,
  description: { type: String, required: true },
  duration: { type: Number, required: true },
  date: Date,
});

const UserSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  username: { type: String, index: true, required: true, unique: true },
  exercise: [{ type: mongoose.Schema.Types.ObjectId, ref: 'exercise' }]
});

const User = mongoose.model('user', UserSchema);
const Exercise = mongoose.model('exercise', ExerciseSchema);

app.use(cors())

app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())

app.use(logger('tiny'))

app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

// https://stackoverflow.com/a/35413963/3011836
function isValidDate(dateString) {
  var regEx = /^\d{4}-\d{2}-\d{2}$/;
  if(!dateString.match(regEx)) return false;  // Invalid format
  var d = new Date(dateString);
  if(!d.getTime() && d.getTime() !== 0) return false; // Invalid date
  return d.toISOString().slice(0,10) === dateString;
}


app.post('/api/exercise/new-user', (req, res, next) => {
  // If user provided continue...
  if(req.body.username) {
    // create user with the username provided
    const user = new User({
      _id: new mongoose.Types.ObjectId(),
      username: req.body.username
    });
    // Save user to database
    user.save(err => {
      if(err) return next(err);
      // Respond with created status, and the created user with its corresponding userId
      // using username as userId to use simple GET .../log/userId=[username/userId] requests
      // userId is not stored in due to avoid duplicated data
      res.status(201).send({ username: user.username, userId: user.username});
    });
  } else {
    const err = new Error("You must provide an username");
    return next(err);
  }
});

app.get('/api/exercise/log', (req, res, next) => {
  // Extract query variables from request
  const {userId, from, to, limit} = req.query;

  // Verify defined user in query
  if(userId) {
    // Construct query options
    const fromQuery = from && isValidDate(from) ? { $gte: new Date(from)} : null;
    const toQuery = to && isValidDate(to) ? { $lt: new Date(to)} : null;
    const dateQuery = ( fromQuery || toQuery ) ? { date: { ...fromQuery, ...toQuery }} : null;
    const limitQuery = limit > 0 ? limit : 0;
    
    // Find user and populate exercise array using query params
    User.findOne({ username: userId }).
    populate(
      {
        path: 'exercise',
        match: { ...dateQuery },
        select: '-_id -__v',
        options: { limit: limitQuery }
      }).
    exec((err, user) => {
        if(err) return next(err);
        if(!user) return next(new Error("User not found"));
        // If no errors and user was found return exercise array
        res.status(200).send(user.exercise);
    });
  }
  else {
    const err = { errors: [new Error("UserId not provided")]};
    return next(err);
  }
  
});

app.post('/api/exercise/add', (req, res, next) => {
  // Extract variables from request body
  const { userId, description, duration, date } = req.body;
  
  // Continue if necessary variables are provided
  if(userId && description && duration) {
    // Find user by username/userId
    User.findOne({ username: userId }, (err, user) => {
      if(err) return next(err);
      if(!user) return next(new Error("User not found"));
      
      // Validate date format
      const trackedDate = isValidDate(date) ? new Date(date) : new Date();
      // Create exercise object
      const newTrackedExercise = new Exercise({
        userId: user.username,
        description,
        duration,
        date: trackedDate
      });
      // Store exercise in database
      newTrackedExercise.save((err, exercise) => {
        if(err) return next(err);
        if(!exercise) return next(new Error("Could not create exercise"));
        
        // Push exercise to user array and save it to db
        user.exercise.push(exercise);
        user.save(err => {
          if(err) return next(err);
          // Created and assignated exercise to user, respond to client
          res.status(201).send({
            username: user.username,
            description: exercise.description,
            duration: exercise.duration,
            date: exercise.date
          });
        });
      });
    });
  } else {
    const err = { errors: [new Error("UserId, description, duration not provided")]};
    return next(err);
  }
});

// Not found middleware
app.use((req, res, next) => {
  return next({status: 404, message: 'not found'})
})

// Error Handling middleware
app.use((err, req, res, next) => {
  let errCode, errMessage

  if (err.errors) {
    // mongoose validation error
    errCode = 400 // bad request
    const keys = Object.keys(err.errors)
    // report the first validation error
    errMessage = err.errors[keys[0]].message
  } else {
    // generic or custom error
    errCode = err.status || 500
    errMessage = err.message || 'Internal Server Error'
  }
  res.status(errCode).type('txt')
    .send(errMessage)
})

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})

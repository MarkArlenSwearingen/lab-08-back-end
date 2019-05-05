'use strict';

//Load Environment Vairables from the .env file
require('dotenv').config();

//Application Dependencies
const express = require('express');
const cors  = require('cors');
const superagent =  require('superagent');
const pg = require('pg');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());

//Application Setup - Configure Server
const client = new pg.Client(process.env.PG_CONNECTION_URL);
client.connect();
client.on('err', err => console.error(err));

//--------------Handle Errors-------------------//
let handleError = (err, response) => {
  console.error(err);
  if(response) response.status(500).send('Status: 500. So sorry, something went wrong');

};

//---------------Constructor Functions----------------------//

//Refactor
function Location(query, data){
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

//static function doesn't need a new location to be run
Location.fetchLocation = (query) => {
  const geoData = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(geoData)
    .then(result => {
      if(!result.body.lenth ) throw 'No data';
      // .catch(error => handleError(error, response));
      let location = new Location(query, result.body.results[0]);
      return location.save()
        .then(result => {
          location.id = result.row[0].id;
          return location;
        });
    });
};

Location.lookup = handler => {
  const SQL = `SELECT * FROM locations WHERE search_query= $1;`;
  const values = [handler.query];
  //postgres expects and array even for one object

  return client.query(SQL, values)
    .then(results => {
      if(results.rowCount > 0) {
        handler.cacheHit(results);
      }else{
        handler.cacheMiss(results);
        console.log('missed');
      }
    });

};

Location.prototype.save = function(){
  let SQL = `INSERT INTO locations (search_query, formatted_query, longitude, latitude)
  VALUES ($1, $2, $3, $4)
  RETURNING id;`;

  let values = Object.values(this);

  return client.query(SQL, values);
};

function Weather(day){
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);

}

function Events(location) {
  let time = Date.parse(location.start.local);
  let newDate = new Date(time).toDateString();

  this.event = newDate;
  this.url = location.url;
  this.name = location.name.text;
  this.summary = location.summary;
}

//----------------Callbacks----------------//
let getLocation = (request, response) => {
  const locationHandler = {
    query: request.query.data,
    cacheHit: results => {
      console.log('got data');
      response.send(results[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(request.query.data)
        .then(results => response.send(results));
    }
  };

  Location.lookup(locationHandler);
};

// -------------------------------
//              Weather
// ----------------------------
let getWeather = (request, response) => {
  const data = request.query.data;
  const darkSky = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${data.latitude},${data.longitude}`;

  return superagent.get(darkSky)
    .then(result => {
      let weather = result.body.daily.data.map( day => {
        return new Weather(day);
      });

      response.send(weather);
    })

    .catch(error => handleError(error, response));
};

// ---------------------------------
//              eventBrite
// ------------------------------             
let searchEvents = (request, response) => {
  const data = request.query.data;
  const eventBrite = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${data.formatted_query}`;

  return superagent.get(eventBrite)
    .then(result => {
      let eventList = result.body.events.map(eventInfo => {
        return new Events(eventInfo);
      });  
      response.send(eventList);
    })
    .catch(error => handleError(error, response));
};

//-------------------API Routes-------------------///
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/events', searchEvents);


//Make sure the server is listening for requests
app.listen(PORT, () => console.log(`App is listening on ${PORT}`));

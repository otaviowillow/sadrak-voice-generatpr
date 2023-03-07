const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const fs = require('fs');
const { exec } = require('child_process');
const textToSpeech = require('@google-cloud/text-to-speech');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const client = new textToSpeech.TextToSpeechClient({
  keyFilename: './keyfile.json',
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const IMAGE_DIR = './images/';

app.post('/generateVideo', async (req, res) => {
  const { dialogue } = req.body;
  const outputFileName = 'output.mp4';
  const outputFilePath = `./${outputFileName}`;
  const voices = [
    { name: 'person1', voice: { languageCode: 'en-US', ssmlGender: 'MALE' }, image: 'person1.png' },
    { name: 'person2', voice: { languageCode: 'en-US', ssmlGender: 'FEMALE' }, image: 'person2.png' },
    { name: 'person3', voice: { languageCode: 'en-GB', ssmlGender: 'MALE' }, image: 'person3.png' },
  ];

  // Create a list of speech requests for each dialogue line
  const speechRequests = dialogue.map((line, i) => {
    console.log(line)
    const { name, text } = line;
    const voice = voices.find(v => v.name === name).voice;
    return {
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'LINEAR16' },
      name: name+i,
    };
  });

  // Call Google Text-to-Speech API to generate audio files for each speech request
  const audioPromises = speechRequests.map(async speechRequest => {
    const [response] = await client.synthesizeSpeech(speechRequest);
    const audioFile = `./audio/${speechRequest.name}.wav`;
    fs.writeFileSync(audioFile, response.audioContent, 'binary');
    return audioFile;
  });

  const removeChar = (str, char_pos) => {
    part1 = str.substring(0, char_pos);
    part2 = str.substring(char_pos + 1, str.length);
    return (part1 + part2);
  }

  // Wait for all audio files to be generated
  const audioFiles = await Promise.all(audioPromises);

  // Create a list of video commands for each dialogue line
  const videoCommands = speechRequests.map((speechRequest, index) => {
    const { name } = speechRequest;
    console.log("NAME", removeChar(name, name.length - 1))
    console.log('speechRequest:', speechRequest);
    const image = voices.find(v => v.name === removeChar(name, name.length - 1)).image;
    const audioFile = audioFiles[index];
    const videoFileName = `${name}.mp4`;
    const videoCommand = ffmpeg()
    .input(`${IMAGE_DIR}${image}`)
    .input(`${audioFile}`)
    .output(videoFileName)
    .videoCodec('libx264')
    .audioCodec('aac')
    .audioBitrate('192k')
    .duration(5)
    .fps(30)
    .outputOptions(['-pix_fmt yuv420p', '-tune stillimage'])
      .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
      });
    return videoCommand;
  });

  // Execute video commands in parallel to generate video files for each speech request
  const videoPromises = videoCommands.map(videoCommand => {
    return new Promise((resolve, reject) => {
      videoCommand
        .on('end', function() {
          resolve();
        })
        .run();
    });
  });


  // Wait for all video files to be generated
  Promise.all(videoPromises).then(async () => {
    console.log('All video files generated successfully');

    // Concatenate all video files into a single video
    let command = ffmpeg();
    speechRequests.forEach(speechRequest => {
      const videoFileName = `${speechRequest.name}.mp4`;
      command = command.input(videoFileName);
    });
    command
      .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
      })
      .on('end', function() {
        console.log('Merging finished!');
        // Delete temporary audio and video files
        speechRequests.forEach(speechRequest => {
          const audioFile = `./audio/${speechRequest.name}.wav`;
          const videoFileName = `${speechRequest.name}.mp4`;
          fs.unlinkSync(audioFile);
          fs.unlinkSync(videoFileName);
        });
        // Send the final output video to the client
        res.sendFile(outputFilePath, function (err) {
          if (err) {
            console.log(err);
            res.status(err.status).end();
          } else {
            console.log('Sent:', outputFilePath);
            fs.unlinkSync(outputFilePath);
          }
        });
      })
      .mergeToFile(outputFilePath);
  });
});

app.listen(3000, () => {
  console.log('Listening on port 3000!');
});

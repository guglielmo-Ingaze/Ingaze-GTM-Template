___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.


___INFO___

{
  "type": "TAG",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "Ingaze Pixel",
  "brand": {
    "id": "brand_dummy",
    "displayName": ""
  },
  "description": "Traccia conversioni ATS, candidate journey e raccoglie analytics in maniera cookieless tramite Ingaze.",
  "containerContexts": [
    "WEB"
  ],
  "categories": [
    "ANALYTICS"
  ]
}


___TEMPLATE_PARAMETERS___

[
  {
    "type": "TEXT",
    "name": "workspaceId",
    "displayName": "Workspace ID",
    "simpleValueType": true,
    "help": "Inserisci l\u0027ID del tuo Workspace Ingaze (es. ing_12345). È obbligatorio.",
    "alwaysInSummary": true,
    "valueValidators": [
      {
        "type": "NON_EMPTY"
      }
    ]
  },
  {
    "type": "TEXT",
    "name": "atsDomain",
    "displayName": "Dominio ATS Esterno (Opzionale)",
    "simpleValueType": true,
    "help": "Se utilizzi un ATS esterno, inserisci qui il dominio base. (es. workday.com, inrecruiting.com)"
  },
  {
    "type": "TEXT",
    "name": "careerSiteUrl",
    "displayName": "URL Sito Carriera (Opzionale)",
    "simpleValueType": true,
    "help": "Inserisci l\u0027URL base del sito carriera (es. https://careers.azienda.com)"
  },
  {
    "type": "TEXT",
    "name": "jobOfferUrl",
    "displayName": "URL Base Offerte di Lavoro (Opzionale)",
    "simpleValueType": true,
    "help": "Inserisci la base dell\u0027URL in cui si trovano le singole offerte (es. /jobs/ o careers.azienda.com/jobs/)"
  }
]


___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const injectScript = require('injectScript');
const setInWindow = require('setInWindow');
const logToConsole = require('logToConsole');

const workspaceId = data.workspaceId;
const atsDomain = data.atsDomain;
const careerSiteUrl = data.careerSiteUrl;
const jobOfferUrl = data.jobOfferUrl;

// Esponi le configurazioni al pixel Ingaze
setInWindow('ingazeWorkspaceId', workspaceId);
if (atsDomain) {
  setInWindow('ingazeAtsDomain', atsDomain);
}
if (careerSiteUrl) {
  setInWindow('ingazeCareerSiteUrl', careerSiteUrl);
}
if (jobOfferUrl) {
  setInWindow('ingazeJobOfferUrl', jobOfferUrl);
}


// L'URL in cui è ospitato lo script del pixel Ingaze.
// Visto che il pixel è un file statico, l'opzione raccomandata e gratuita è ospitarlo
// nella stessa repository GitHub in cui salverete questo template, 
// utilizzando la CDN jsDelivr.
// Sostituite 'user/repo' con i vostri dati GitHub.
const scriptUrl = 'https://cdn.jsdelivr.net/gh/guglielmo-Ingaze/Ingaze-GTM-Template@main/pixel.js';

// Inject the script
injectScript(scriptUrl, function() {
  logToConsole('Ingaze pixel loaded successfully');
  data.gtmOnSuccess();
}, function() {
  logToConsole('Ingaze pixel failed to load');
  data.gtmOnFailure();
}, 'ingaze_pixel');


___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {
        "publicId": "inject_script",
        "versionId": "1"
      },
      "param": [
        {
          "key": "urls",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 1,
                "string": "https://cdn.jsdelivr.net/gh/guglielmo-Ingaze/Ingaze-GTM-Template/*"
              },
              {
                "type": 1,
                "string": "https://ingaze-tracking-worker.guglielmo-84a.workers.dev/"
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "access_globals",
        "versionId": "1"
      },
      "param": [
        {
          "key": "keys",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "ingazeWorkspaceId"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "ingazeAtsDomain"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "ingazeCareerSiteUrl"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "ingazeJobOfferUrl"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  },
  {
    "instance": {
      "key": {
        "publicId": "logging",
        "versionId": "1"
      },
      "param": [
        {
          "key": "environments",
          "value": {
            "type": 1,
            "string": "debug"
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  }
]


___TESTS___

scenarios:
- name: Untitled test 1
  code: |-
    const mockData = {
      // Mocked field values
    };

    // Diciamo a GTM di fingere che il download dello script vada a buon fine
    mock('injectScript', function(url, onSuccess, onFailure) {
      onSuccess(); // Forza l'esecuzione del callback di successo
    });

    // Assicuriamoci anche di mockare setInWindow per evitare altri errori
    mock('setInWindow', function(key, value, override) {
      // Simula il comportamento senza fare nulla di reale
    });

    // Call runCode to run the template's code.
    runCode(mockData);

    // Verify that the tag finished successfully.
    assertApi('gtmOnSuccess').wasCalled();


___NOTES___

Created on 05/05/2026, 15:46:20
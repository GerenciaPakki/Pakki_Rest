const axios = require('axios');
const mustache = require('mustache');
const xml2js = require('xml2js');
const builder = require('xmlbuilder');
const parser = require('xml2js').parseString;
const { DateTime } = require('luxon');

const parsero = new xml2js.Parser();
const buildero = new xml2js.Builder();

const { xmlShipDocUPS, xmlResponseShipDocUPS, xmlShipPkgUPS } = require('../structures/xml/shipUPS');
const shipments = require('../models/shipments');
const { getShipmentDBUPS } = require('../structures/json/shipmentUPS');
const { SurchargePakkiUPS, SurchargePakkiShipmentUPS } = require('./companySurcharges');
const { ShipXML_FDX_PKG } = require('../structures/xml/shipFDX');
const { marcaDeTiempo } = require('./pakkiDateTime');
const { UPS_CONFIRMATION_URL, UPS_ACCEPT_URL } = require('../utils/config');

// Creating a date time object
const date = DateTime.local().toISODate();
// const url = 'https://onlinetools.ups.com/ups.app/xml/ShipConfirm'; //PRODUCCION
// const url = 'https://wwwcie.ups.com/ups.app/xml/ShipConfirm';
const url = UPS_CONFIRMATION_URL


async function REQ_1_ShipmentUPS(dat) { 
    
  let ProvidersUPS = [];
  let jsonResUPS = [];
  let ShipUPS_XML = ''
  let xmlResUPS = ''
  let resp = ''
  let dataLabel = {}

  ShipUPS_XML = mustache.render(xmlShipDocUPS, dat);

    return axios.post(url, ShipUPS_XML, {})
      .then(response => {
        xmlResUPS = response.data;
        xml2js.parseString(xmlResUPS, (error, result) => {
          if (error) {
              console.error(error);
          } else {
              jsonResUPS.push(result);                    
          }
        });

        resp = jsonResUPS[0].ShipmentConfirmResponse;
       
        const responseStatusCode = resp.Response[0].ResponseStatusCode[0];
        if (responseStatusCode === '0') { // 0 indicates failure in UPS responses
          const errorDescription = resp.Response[0].Error[0].ErrorDescription[0];
          return {
            ok: false,
            msg: 'Error UPS_CO Generar Guia: SaveShipmentUPS01 ' + errorDescription
          };
        }

        dataLabel = {
          CurrencyCode: resp.ShipmentCharges[0].TotalCharges[0].CurrencyCode[0],
          MonetaryValue: resp.ShipmentCharges[0].TotalCharges[0].MonetaryValue[0],
          ShipmentCode: resp.ShipmentIdentificationNumber[0],
          ShipmentDigest: resp.ShipmentDigest[0]
        };
          
        return dataLabel;
        // return resp;

      }).catch(error => {
        // console.log('Error de UPS CO_INT: ', error.response);
        //   console.log('Error de UPS CO Destalle: ', error);
        return {
          OK:false,
          error: 'Error UPS_CO Generar Guia: SaveShipmentUPS01',
          msg: error
        };
      });

}


async function REQ_2_ShipmentUPS(dat, req1UPS) { 
  
  let ProvidersUPS = [];
  let jsonResUPS = [];
  let Ship2UPS_XML = ''
  let xmlResUPS = ''
  let resp = ''
  let SurchargePakki = ''
  let dataLabel = {}
    
    Ship2UPS_XML = mustache.render(xmlResponseShipDocUPS, req1UPS);
    // const url = 'https://onlinetools.ups.com/ups.app/xml/ShipAccept'; //PRODUCCION
    // const url = 'https://wwwcie.ups.com/ups.app/xml/ShipAccept'; // SANDBOX
    const url = UPS_ACCEPT_URL
  // console.log(Ship2UPS_XML)  
  return axios.post(url, Ship2UPS_XML, {})
      .then( async response => {
        xmlResUPS = response.data
        // console.log(xmlResUPS)
        xml2js.parseString(xmlResUPS, (error, result) => {
          if (error) {
              console.error(error);
          } else {
            jsonResUPS.push(result); 
          }
        });
        // console.log(jsonResUPS[0].ShipmentAcceptResponse.ShipmentResults[0].PackageResults[0]);
        if (jsonResUPS[0].hasOwnProperty('ShipmentResults')) {
          return {
            ok: false,
            error: 'Error UPS_CO Pickup: SaveShipmentUPS01',
            msg: jsonResUPS[0].ShipmentAcceptResponse.Response[0].Error
          };
        } 
        resp = jsonResUPS[0].ShipmentAcceptResponse.ShipmentResults[0];

        //TODO: Variables que se procesaran con los Incrementos de Pakki
        const ServiceType = dat.Provider.serviceName
        const ProvicerDiscount = resp.BillingWeight[0].UnitOfMeasurement[0]
        const Domestic = dat.Shipments.documentShipment
        const Weight = dat.Shipments.Shipment.Weight
        const shippingValue = resp.ShipmentCharges[0].TotalCharges[0].MonetaryValue[0]
        
        
        SurchargePakki = await SurchargePakkiShipmentUPS(ServiceType,shippingValue,ProvicerDiscount,Domestic,Weight)

        dataLabel = {
          CurrencyCode: resp.ShipmentCharges[0].TotalCharges[0].CurrencyCode[0],
          MonetaryValue: SurchargePakki.MonetaryValue,
          FinalUserAmount: SurchargePakki.shippingValue,
          ConversionRate: SurchargePakki.exchangeRate,
          shipValue: SurchargePakki.shipValue,
          PublicAmount: SurchargePakki.PublicAmount,
          ShipmentCode: resp.ShipmentIdentificationNumber[0],
          LabelImage: resp.PackageResults[0].LabelImage[0].GraphicImage[0]
        };

        return dataLabel;

      }).catch(error => {
        console.log('Error de UPS CO_INT: ', error);
        return {
          OK: false,
          error: 'Error UPS_CO Pickup: SaveShipmentUPS02',
          msg: error
        };
      });

}
async function REQ_1_ShipmentPkgUPS(dat) { 
    
  let jsonResUPS = [];
  let root = ''
  let xmlShipUPS = ''
  let xmlResUPS = ''
  let resp = ''
  let dataLabel = {}
  
  const Invoice = dat.Shipments.Shipment.Invoice;

// Creamos el elemento raíz
root = builder.create('ShipmentServiceOptions');

const internationalForms = root.ele('InternationalForms');
internationalForms
  .ele('FormType', '01').up()
  .ele('InvoiceNumber', '0').up()
  .ele('InvoiceDate', Invoice.DateTimeUPS).up()
  .ele('ReasonForExport', Invoice.ReasonCode).up()
  .ele('TermsOfShipment', 'CIP').up()
  .ele('DeclarationStatement', 'I hereby certify that the information on thisinvoice is true and correct and the contents and value of this shipmentis as stated above.').up()
  .ele('CurrencyCode', 'USD');

Invoice.Items.Item.forEach(item => {
  const product = internationalForms.ele('Product');
  product
    .ele('Description', item.ItemDescription).up()
    .ele('Unit')
    .ele('Number', item.LineId).up()
    .ele('UnitOfMeasurement')
    .ele('Code', 'PCS').up()
    .up()
    .ele('Value', item.ValuePerUnit).up()
    .up()
    .ele('OriginCountryCode', Invoice.CountryOfManufacture).up();
});

root.end();

  let UPS_PkgToJson = '';
  let xmlShipmentUPS = '';

  // Convertimos el objeto XML a cadena y lo mostramos en la consola
  parser(root.toString(), (err, result) => {
      if (err) {
          console.error(err);
      } else {
          // Convertimos el objeto XML a cadena y lo mostramos en la consola
          UPS_PkgToJson = result.ShipmentServiceOptions;
      }
  });

  // Nuevo valor para la etiqueta ShipmentServiceOptions
  const newShipmentServiceOptions = [ UPS_PkgToJson ];
  
//  const xmlShipUPS = mustache.render(xmlShipPkgUPS, dat);
  xmlShipUPS = mustache.render(xmlShipPkgUPS, dat);

  // console.log('xmlShipUPS: ',xmlShipUPS)
  
  xml2js.parseString(xmlShipUPS, (err, result) => {
    if (err) {
      console.error(err);
    } else {
      result.root.ShipmentConfirmRequest[0].Shipment[0].ShipmentServiceOptions = newShipmentServiceOptions;
      // REMOVEMOS LA ETIQUETA ROOT DE LA ESTRUCTURA PARA ENVIAR A UPS
      const xmlWithoutRoot = buildero.buildObject(result).replace(/<\/?root>/g, '');
      xmlShipmentUPS = xmlWithoutRoot;
    }
  });
  return axios.post(url, xmlShipmentUPS, {})
    .then(response => {
      xmlResUPS = response.data;
      xml2js.parseString(xmlResUPS, (error, result) => {
        if (error) {
            console.error(error);
        } else {
            jsonResUPS.push(result);                    
        }
      });

      resp = jsonResUPS[0].ShipmentConfirmResponse;
      // console.log(resp.ShipmentCharges[0].TotalCharges[0].MonetaryValue[0]);
      dataLabel = {
        CurrencyCode: resp.ShipmentCharges[0].TotalCharges[0].CurrencyCode[0],
        MonetaryValue: resp.ShipmentCharges[0].TotalCharges[0].MonetaryValue[0],
        ShipmentCode: resp.ShipmentIdentificationNumber[0],
        ShipmentDigest: resp.ShipmentDigest[0]
      };
        
      return dataLabel;
      // return resp;

    }).catch(error => {
      // console.log('Error de UPS CO_INT: ', error.response);
      //   console.log('Error de UPS CO Destalle: ', error);
      return {
          error: 'Error UPS_CO Generar Guia: SaveShipmentUPS01',
          msg: error
      };
    });

}
async function REQ_2_ShipmentPkgUPS(dat, req1UPS) { 
  let jsonResUPS = [];
  let Ship2UPS_XML = ''
  let xmlResUPS = ''
  let resp = ''
  let SurchargePakki = ''
  let dataLabel = {}
  
  Ship2UPS_XML = mustache.render(xmlResponseShipDocUPS, req1UPS);
    // const url = 'https://onlinetools.ups.com/ups.app/xml/ShipAccept'; //PRODUCCION
    // const url = 'https://wwwcie.ups.com/ups.app/xml/ShipAccept'; // SANDBOX
    const url = UPS_ACCEPT_URL
    
    return axios.post(url, Ship2UPS_XML, {})
      .then( async response => {
        xmlResUPS = response.data;
        // console.log('xmlResUPS: ', xmlResUPS)
        xml2js.parseString(xmlResUPS, (error, result) => {
          if (error) {
              console.error(error);
          } else {
              jsonResUPS.push(result);                    
          }
        });

        resp = jsonResUPS[0].ShipmentAcceptResponse.ShipmentResults[0];
        // console.log('resp: ', resp.ShipmentIdentificationNumber)
         //TODO: Variables que se procesaran con los Incrementos de Pakki
        const ServiceType = dat.Provider.serviceName
        const ProvicerDiscount = resp.BillingWeight[0].UnitOfMeasurement[0]
        const Domestic = dat.Shipments.documentShipment
        const Weight = dat.Shipments.Shipment.Weight
        const shippingValue = resp.ShipmentCharges[0].TotalCharges[0].MonetaryValue[0]
        
        SurchargePakki = await SurchargePakkiShipmentUPS(ServiceType, shippingValue,ProvicerDiscount,Domestic,Weight)
        dataLabel = {
          CurrencyCode: resp.ShipmentCharges[0].TotalCharges[0].CurrencyCode[0],
          MonetaryValue: SurchargePakki.MonetaryValue,
          FinalUserAmount: SurchargePakki.shippingValue,
          ConversionRate: SurchargePakki.exchangeRate,
          shipValue: SurchargePakki.shipValue,
          PublicAmount: SurchargePakki.PublicAmount,
          ShipmentCode: resp.ShipmentIdentificationNumber[0],
          LabelImage: resp.PackageResults[0].LabelImage[0],
          Package: resp.Form
        };
        
        return dataLabel;

      }).catch(error => {
        console.log('Error de UPS CO_INT: ', error);
        //   console.log('Error de UPS CO Destalle: ', error);
        return {
            error: 'Error UPS_CO Pickup: SaveShipmentUPS03',
            msg: error.response
        };
      });

}

async function pickup_UPS(dat, ShipmentID, PickupRequired) {

  // console.log(ShipmentID);

  let updatedValuesPickup = {}
  let ShipPickupUpdate = ''
  
  if (PickupRequired === true) {
    updatedValuesPickup = {
      $set: {
        Pickup: {
          PickupRequired: true,
          PickupCode: "1111",
          PickupDate: dat.Pickup.DateTime,
          PickCDRtartTime: dat.Pickup.TimeStart,
          PickupEndTime: dat.Pickup.TimeEnd,
          PickupAutomatic: true,
          PickupContactName: dat.Pickup.ContactName,
          PickupPhoneNumber: dat.Pickup.ContactPhone,
          PickupAddress: dat.Pickup.Address,
          PickupAddressDetails: dat.Pickup.AddressAdditional,
          PickupAddressDetails2: dat.Pickup.AddressAdditional1,
          PickupNotes: dat.Pickup.Comments,
          dateCreate: marcaDeTiempo,
        },
        statusPickup: true
      }
    };
    const options = { upsert: true, returnOriginal: false };
    ShipPickupUpdate = await shipments.findOneAndUpdate({ ShipmentID: ShipmentID },
      updatedValuesPickup, options);
    
    return ShipPickupUpdate;

  } else {
    updatedValuesPickup = {
        $set: {
            Pickup: {
                PickupRequired: false,
                PickupCode: '0000',
                PickupDate: '',
                PickupStartTime: '',
                PickupEndTime: '',
                PickupAutomatic: false,
                PickupContactName: '',
                PickupPhoneNumber: '',
                PickupAddress: '',
                PickupAddressDetails: '',
                PickupAddressDetails2: '',
                PickupNotes: '',
                dateCreate: marcaDeTiempo,
            },
            statusPickup: true
        }
    };
    const options = { upsert: true, returnOriginal: false };
    ShipPickupUpdate = await shipments.findOneAndUpdate({ ShipmentID: ShipmentID },
      updatedValuesPickup, options);
    return ShipPickupUpdate;
  }  
}


module.exports = {
  REQ_1_ShipmentUPS,
  REQ_2_ShipmentUPS,
  REQ_1_ShipmentPkgUPS,
  REQ_2_ShipmentPkgUPS,
  pickup_UPS,
};
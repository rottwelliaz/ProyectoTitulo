import Joi from 'joi';

const soloLetrasRegex = /^[\p{L}\s]+$/u;
const rutRegex = /^\d{8}-\d$/;
const soloNumerosRegex = /^\d+$/;

const textoSoloLetras = (campo: string) =>
  Joi.string()
    .trim()
    .pattern(soloLetrasRegex)
    .required()
    .messages({
      'string.base': `${campo} debe ser texto`,
      'string.empty': `${campo} es obligatorio`,
      'string.pattern.base': `${campo} solo puede contener letras`,
      'any.required': `${campo} es obligatorio`,
    });

export const datosBancariosValidation = Joi.object({
  nombre: textoSoloLetras('El nombre'),
  rut: Joi.string()
    .trim()
    .pattern(rutRegex)
    .required()
    .messages({
      'string.base': 'El rut debe ser texto',
      'string.empty': 'El rut es obligatorio',
      'string.pattern.base': 'El rut debe tener el formato XXXXXXXX-X y solo numeros',
      'any.required': 'El rut es obligatorio',
    }),
  banco: textoSoloLetras('El banco'),
  tipoCuenta: textoSoloLetras('El tipo de cuenta'),
  nroCuenta: Joi.string()
    .trim()
    .pattern(soloNumerosRegex)
    .required()
    .messages({
      'string.base': 'El numero de cuenta debe ser texto',
      'string.empty': 'El numero de cuenta es obligatorio',
      'string.pattern.base': 'El numero de cuenta solo puede contener numeros',
      'any.required': 'El numero de cuenta es obligatorio',
    }),
  correo: Joi.string()
    .trim()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      'string.base': 'El correo debe ser texto',
      'string.empty': 'El correo es obligatorio',
      'string.email': 'El correo no es valido',
      'any.required': 'El correo es obligatorio',
    }),
}).unknown(false).messages({
  'object.unknown': 'No se permiten campos adicionales en los datos bancarios',
});

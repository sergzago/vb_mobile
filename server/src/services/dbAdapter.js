/**
 * Абстрактный слой доступа к данным для ScoreboardService
 * Работает только с PocketBase
 */

const { VOLLEYBALL_COLLECTION, MATCHES_COLLECTION, GAME_CONSTANTS } = require('../../../js/db-config');

/**
 * Создать утилиту работы с БД
 * @param {{provider: string, client: object|null}} dbConfig
 */
function createDbAdapter(dbConfig) {
  const { provider, client } = dbConfig;

  /**
   * Получить документ
   */
  async function getDoc(collection, docId) {
    try {
      const record = await client.collection(collection).getOne(docId);
      return record;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Обновить документ
   */
  async function updateDoc(collection, docId, data) {
    // PocketBase — разделяем обычные поля и null (для удаления)
    const updateData = {};
    const deleteFields = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === null) {
        deleteFields.push(key);
      } else {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await client.collection(collection).update(docId, updateData);
    }

    // PocketBase: удаление полей через null
    if (deleteFields.length > 0) {
      const nullData = {};
      deleteFields.forEach(f => { nullData[f] = null; });
      await client.collection(collection).update(docId, nullData);
    }

    return getDoc(collection, docId);
  }

  /**
   * Создать/заменить документ
   */
  async function setDoc(collection, docId, data, options = {}) {
    // PocketBase
    if (options.merge) {
      return updateDoc(collection, docId, data);
    }
    await client.collection(collection).create({ id: docId, ...data });
    return getDoc(collection, docId);
  }

  /**
   * Создать запись (авто-ID)
   */
  async function addDoc(collection, data) {
    // PocketBase
    const record = await client.collection(collection).create(data);
    return record;
  }

  /**
   * Запрос коллекции с фильтрами
   */
  async function queryDocs(collection, filters = {}) {
    // PocketBase
    const listFilters = {};
    if (filters.where) {
      const filterParts = [];
      for (const [field, op, value] of filters.where) {
        let pbOp = '=';
        if (op === '>=') pbOp = '>=';
        else if (op === '<=') pbOp = '<=';
        else if (op === '==') pbOp = '=';
        filterParts.push(`${field} ${pbOp} "${value}"`);
      }
      listFilters.filter = filterParts.join(' && ');
    }
    if (filters.orderBy) {
      const dir = filters.orderBy.direction === 'asc' ? '+' : '-';
      listFilters.sort = `${dir}${filters.orderBy.field}`;
    }
    if (filters.limit) {
      listFilters.perPage = filters.limit;
    }

    return client.collection(collection).getFullList(listFilters);
  }

  /**
   * Server timestamp или аналог
   */
  function serverTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Delete field
   */
  function deleteField() {
    return null; // PocketBase: null удаляет поле
  }

  return {
    getDoc,
    updateDoc,
    setDoc,
    addDoc,
    queryDocs,
    serverTimestamp,
    deleteField,
    provider,
    client,
  };
}

module.exports = { createDbAdapter, VOLLEYBALL_COLLECTION, MATCHES_COLLECTION, GAME_CONSTANTS };

// js/trazabilidad-ui.js - Módulo independiente de Trazabilidad (MODULAR)
class TrazabilidadSystem {
    constructor(container) {
        this.container = container;
        this.core = new TrazabilidadCore();
        this.chart1 = null;
        this.chart2 = null;
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) {
            return this;
        }
        
        this.render();
        this.bindEvents();
        this.initializeTrazabilidadLogic();
        this.isInitialized = true;
        return this;
    }

    // MÉTODO DESTROY PARA LIMPIEZA
    destroy() {
        console.log('Limpiando módulo de Trazabilidad...');
        
        // Limpiar gráficos
        if (this.chart1) {
            this.chart1.destroy();
            this.chart1 = null;
        }
        if (this.chart2) {
            this.chart2.destroy();
            this.chart2 = null;
        }
        
        // Limpiar instancias
        this.core = null;
        this.isInitialized = false;
        
        console.log('Módulo de Trazabilidad limpiado correctamente');
    }

    render() {
        this.container.innerHTML = `
            <button class="back-button" id="backToReports">← Volver a Reportes</button>
            <div class="trazabilidad-container">
                <div class="trazabilidad-header">
                    <h3>Analizador de Trazabilidad de Mercancía</h3>
                    <p>Sube un archivo Excel con las columnas: Material, Texto breve de material, Centro, Almacén, Clase de movimiento, Documento material, Fe.contabilización, Hora de entrada, Ctd.en UM entrada, Un.medida de entrada, Cliente, Nombre del usuario</p>
                </div>

                <div class="search-card">
                    <div class="filter-controls">
                        <div class="filter-input-group">
                            <label for="fileInput">Archivo Excel (.xlsx/.xls):</label>
                            <input type="file" id="fileInput" accept=".xlsx,.xls" />
                        </div>

                        <div class="filter-input-group">
                            <label for="filterCentro">Filtro Centro:</label>
                            <select id="filterCentro" class="custom-select">
                                <option value="">-- Todos --</option>
                            </select>
                        </div>

                        <div class="filter-input-group">
                            <label for="filterMaterial">Filtro Material:</label>
                            <input id="filterMaterial" type="text" placeholder="Buscar material..." />
                        </div>
                    </div>

                    <div class="row" style="margin-top: 20px; justify-content: flex-start; gap: 10px; flex-wrap: wrap;">
                        <button id="listMaterialsBtn" disabled>Listar Materiales</button>
                        <button id="configStockBtn" class="alt" disabled>Configurar stock inicial</button>
                        <button id="generateBtn" class="alt" disabled>Generar reporte</button>
                        <button id="downloadExcelBtn" class="alt" disabled>Descargar Excel</button>
                        <button id="selectAllBtn" class="alt">Seleccionar todos</button>
                        <button id="clearAllBtn" class="alt">Deseleccionar</button>
                        <button id="reiniciarBtn" class="alt">Reiniciar</button>
                    </div>
                </div>

                <div id="materialsSection" class="search-card hidden">
                    <h4>Materiales detectados</h4>
                    <p class="muted">Selecciona los materiales que deseas analizar (puedes seleccionar varios).</p>
                    <div id="materialsContainer" class="materials-list"></div>
                </div>

                <div id="reportSection" class="hidden">
                    <div class="search-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <div>
                                <h4 style="margin-bottom: 5px;">Reporte</h4>
                                <small id="reportMeta" class="muted"></small>
                            </div>
                            <div style="text-align: right;">
                                <small class="muted">Materiales analizados:</small>
                                <div id="materialsAnalizados" style="font-size: 0.9rem;"></div>
                            </div>
                        </div>

                        <div class="table-container">
                            <table class="inventory-table">
                                <thead>
                                    <tr>
                                        <th>Material</th>
                                        <th>Texto breve</th>
                                        <th>UMB</th>
                                        <th>Centro</th>
                                        <th>Tienda</th>
                                        <th>Rango de fecha</th>
                                        <th>Último ingreso</th>
                                        <th>Ajustes (+ / -)</th>
                                        <th>Usuarios Ajuste</th> <!-- NUEVA COLUMNA -->
                                        <th>Fecha de ajuste</th>
                                        <th>Puntos cero</th>
                                        <th>Posible irregularidad</th>
                                        <th>Usuario de irregularidad</th>
                                        <th>Descripción de irregularidad</th>
                                        <th>Tipo de diferencia</th>
                                        <th>Total salidas por tienda</th>
                                        <th>Total salidas a clientes</th>
                                        <th>Salida max. por tienda</th>
                                        <th>Salida min. por tienda</th>
                                        <th>Salida max. a clientes</th>
                                        <th>Salida min. a clientes</th>
                                        <th>Promedio salida por tienda</th>
                                        <th>Promedio salida por cliente</th>
                                        <th>Stock Actual</th>
                                    </tr>
                                </thead>
                                <tbody id="reportBody"></tbody>
                            </table>
                        </div>

                        <div class="charts-container">
                            <div class="chart-card">
                                <h6>Tipos de Movimiento por Destino</h6>
                                <div class="chart-wrapper">
                                    <canvas id="chartMovimientos"></canvas>
                                </div>
                            </div>
                            <div class="chart-card">
                                <h6>Distribución Total de Salidas</h6>
                                <div class="chart-wrapper">
                                    <canvas id="chartDistribucion"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Modal para stock inicial - ACTUALIZADO CON SCROLL -->
                <div id="stockModal" class="modal-overlay hidden">
                    <div class="modal-content" style="max-height: 90vh; overflow-y: auto; width: 90%; max-width: 600px;">
                        <div class="modal-header" style="position: sticky; top: 0; background: #2d3748; z-index: 10; padding: 20px; border-bottom: 1px solid #4a5568;">
                            <h5 style="margin: 0; color: white;">Configurar stock inicial</h5>
                            <button id="closeStockBtnTop" class="close-btn" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">×</button>
                        </div>
                        <div id="stockModalBody" class="modal-body" style="padding: 20px;"></div>
                        <div class="modal-footer" style="position: sticky; bottom: 0; background: #2d3748; z-index: 10; padding: 20px; border-top: 1px solid #4a5568; display: flex; gap: 10px; justify-content: flex-end;">
                            <button id="saveStockBtn" style="padding: 10px 20px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Guardar</button>
                            <button id="closeStockBtn" class="alt" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Cerrar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
    // Event listener directo para el botón volver - VERSIÓN CORREGIDA
    setTimeout(() => {
        const backButton = document.getElementById('backToReports');
        if (backButton) {
            backButton.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Botón Volver a Reportes clickeado - Evento directo'); // Debug
                this.goBackToReports();
            });
        } else {
            console.error('No se encontró el botón backToReports');
        }
    }, 100);

    // También mantener la delegación de eventos como respaldo
    this.container.addEventListener('click', (e) => {
        if (e.target.id === 'backToReports' || e.target.closest('#backToReports')) {
            e.preventDefault();
            console.log('Botón Volver a Reportes clickeado - Delegación'); // Debug
            this.goBackToReports();
        }
    });
}

// Método específico para volver a reportes
goBackToReports() {
    console.log('Ejecutando goBackToReports');
    
    // Opción 1: Usar ModulesManager si está disponible
    if (window.modulesManager) {
        console.log('Navegando mediante ModulesManager');
        window.modulesManager.showMainMenu();
        return;
    }
    
    // Opción 2: Usar el sistema de navegación existente
    if (typeof initializeReportsSystem === 'function') {
        console.log('Navegando mediante initializeReportsSystem');
        initializeReportsSystem();
        return;
    }
    
    // Opción 3: Fallback - recargar la sección de reportes
    console.log('Usando fallback de navegación');
    const reportsSection = document.getElementById('reports');
    if (reportsSection) {
        reportsSection.innerHTML = '<div class="loading-state">Cargando reportes...</div>';
        setTimeout(() => {
            this.showReportsMenu();
        }, 100);
    }
}

    showReportsMenu() {
    // Limpiar primero cualquier contenido existente
    this.container.innerHTML = '';
    
    // Verificar si existe el ModulesManager
    if (window.modulesManager) {
        window.modulesManager.showMainMenu();
        return;
    }
    
    // Fallback: mostrar menú directamente
    this.container.innerHTML = `
        <div class="reports-menu">
            <div class="report-option" data-report="trazabilidad">
                <div class="report-icon">📊</div>
                <h3>Trazabilidad</h3>
                <p>Análisis de movimientos de inventario</p>
            </div>
            
            <div class="report-option" data-report="analisis-pedidos">
                <div class="report-icon">📦</div>
                <h3>Análisis de Pedidos</h3>
                <p>Próximamente...</p>
            </div>
        </div>
    `;

    // Reconectar eventos para el menú de reportes
    document.querySelectorAll('.report-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const reportType = e.currentTarget.dataset.report;
            if (reportType === 'trazabilidad') {
                this.render();
                this.bindEvents(); // ¡IMPORTANTE! Reconectar eventos después de renderizar
                this.initializeTrazabilidadLogic();
            } else {
                this.showCustomAlert('Esta funcionalidad estará disponible próximamente', 'info');
            }
        });
    });
    }

    loadReport(reportType) {
        if (reportType === 'trazabilidad') {
            this.render();
            this.initializeTrazabilidadLogic();
        } else {
            this.showCustomAlert('Esta funcionalidad estará disponible próximamente', 'info');
        }
    }

    // Función para mostrar confirmación personalizada
    showCustomConfirm(message, confirmCallback, cancelCallback) {
        // Crear overlay de confirmación
        const confirmOverlay = document.createElement('div');
        confirmOverlay.className = 'alert-overlay';
        confirmOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease-out;
        `;

        // Configuración para tipo warning
        const config = { 
            color: '#ff9800', 
            icon: '⚠', 
            title: 'Confirmar' 
        };

        // Crear contenido de la confirmación
        confirmOverlay.innerHTML = `
            <div class="alert-modal" style="
                background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
                border-radius: 16px;
                padding: 30px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid #4a5568;
                min-width: 450px;
                max-width: 500px;
                animation: modalSlideIn 0.3s ease-out;
                position: relative;
                color: white;
                text-align: center;
            ">
                <div class="alert-icon" style="
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    font-size: 28px;
                    background: ${config.color}20;
                    border: 2px solid ${config.color};
                    color: ${config.color};
                ">
                    ${config.icon}
                </div>
                <div class="alert-content">
                    <h3 class="alert-title" style="
                        font-size: 1.5rem;
                        font-weight: 700;
                        margin-bottom: 10px;
                        color: white;
                    ">${config.title}</h3>
                    <p class="alert-message" style="
                        font-size: 1.1rem;
                        line-height: 1.5;
                        color: #cbd5e0;
                        margin-bottom: 0;
                    ">${message}</p>
                </div>
                <div class="alert-actions" style="
                    display: flex;
                    gap: 15px;
                    justify-content: center;
                    margin-top: 25px;
                ">
                    <button class="confirm-btn" style="
                        padding: 12px 30px;
                        border: none;
                        border-radius: 8px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        min-width: 120px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);
                        color: white;
                        border: 1px solid #4caf50;
                    ">Aceptar</button>
                    <button class="cancel-btn" style="
                        padding: 12px 30px;
                        border: none;
                        border-radius: 8px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        min-width: 120px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
                        color: white;
                        border: 1px solid #f44336;
                    ">Cancelar</button>
                </div>
            </div>
        `;

        // Agregar estilos de animación si no existen
        if (!document.querySelector('#alert-styles')) {
            const styles = document.createElement('style');
            styles.id = 'alert-styles';
            styles.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-50px) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                .confirm-btn:hover, .cancel-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
                }
                .confirm-btn:active, .cancel-btn:active {
                    transform: translateY(0);
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(confirmOverlay);

        // Event listeners para los botones
        const confirmBtn = confirmOverlay.querySelector('.confirm-btn');
        const cancelBtn = confirmOverlay.querySelector('.cancel-btn');

        confirmBtn.addEventListener('click', () => {
            confirmOverlay.remove();
            if (confirmCallback) confirmCallback();
        });

        cancelBtn.addEventListener('click', () => {
            confirmOverlay.remove();
            if (cancelCallback) cancelCallback();
        });

        // Cerrar al hacer click fuera del modal
        confirmOverlay.addEventListener('click', (e) => {
            if (e.target === confirmOverlay) {
                confirmOverlay.remove();
                if (cancelCallback) cancelCallback();
            }
        });
    }

    // Función mejorada para mostrar alertas personalizadas
    showCustomAlert(message, type = 'info') {
        // Crear overlay de alerta
        const alertOverlay = document.createElement('div');
        alertOverlay.className = 'alert-overlay';
        alertOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease-out;
        `;

        // Definir colores según el tipo
        const typeConfig = {
            success: { color: '#4caf50', icon: '✓', title: 'Éxito' },
            error: { color: '#e53935', icon: '✕', title: 'Error' },
            warning: { color: '#ff9800', icon: '⚠', title: 'Advertencia' },
            info: { color: '#2196F3', icon: 'ℹ', title: 'Información' }
        };

        const config = typeConfig[type] || typeConfig.info;

        // Crear contenido de la alerta
        alertOverlay.innerHTML = `
            <div class="alert-modal" style="
                background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
                border-radius: 16px;
                padding: 30px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid #4a5568;
                min-width: 400px;
                max-width: 500px;
                animation: modalSlideIn 0.3s ease-out;
                position: relative;
                color: white;
                text-align: center;
            ">
                <div class="alert-icon" style="
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    font-size: 28px;
                    background: ${config.color}20;
                    border: 2px solid ${config.color};
                    color: ${config.color};
                ">
                    ${config.icon}
                </div>
                <div class="alert-content">
                    <h3 class="alert-title" style="
                        font-size: 1.5rem;
                        font-weight: 700;
                        margin-bottom: 10px;
                        color: white;
                    ">${config.title}</h3>
                    <p class="alert-message" style="
                        font-size: 1.1rem;
                        line-height: 1.5;
                        color: #cbd5e0;
                        margin-bottom: 0;
                    ">${message}</p>
                </div>
                <div class="alert-actions" style="
                    display: flex;
                    gap: 15px;
                    justify-content: center;
                    margin-top: 25px;
                ">
                    <button class="alert-btn" style="
                        padding: 12px 30px;
                        border: none;
                        border-radius: 8px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        min-width: 120px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        background: linear-gradient(135deg, ${config.color} 0%, ${this.darkenColor(config.color, 20)} 100%);
                        color: white;
                        border: 1px solid ${config.color};
                    " onclick="this.closest('.alert-overlay').remove()">
                        Aceptar
                    </button>
                </div>
            </div>
        `;

        // Agregar estilos de animación si no existen
        if (!document.querySelector('#alert-styles')) {
            const styles = document.createElement('style');
            styles.id = 'alert-styles';
            styles.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-50px) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                .alert-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px ${config.color}40;
                }
                .alert-btn:active {
                    transform: translateY(0);
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(alertOverlay);

        // Auto-remover después de 4 segundos para tipos de info/success
        if (type === 'info' || type === 'success') {
            setTimeout(() => {
                if (alertOverlay.parentNode) {
                    alertOverlay.remove();
                }
            }, 4000);
        }

        // Cerrar al hacer click fuera del modal
        alertOverlay.addEventListener('click', (e) => {
            if (e.target === alertOverlay) {
                alertOverlay.remove();
            }
        });
    }

    // Función auxiliar para oscurecer colores
    darkenColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (
            0x1000000 +
            (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255)
        ).toString(16).slice(1);
    }

    // Función para abrir modal (PERMITE SCROLL)
    openModal() {
        const modal = document.getElementById('stockModal');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        
        // Asegurar que el modal esté centrado y sea desplazable
        modal.style.alignItems = 'flex-start';
        modal.style.paddingTop = '20px';
        modal.style.paddingBottom = '20px';
        
        // Forzar reflow y luego agregar clase de animación
        setTimeout(() => {
            modal.style.opacity = '1';
        }, 10);
    }

    // Función para cerrar modal
    closeModal() {
        const modal = document.getElementById('stockModal');
        modal.style.opacity = '0';
        
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }, 300);
    }

    // Función para reiniciar el sistema
    reiniciarSistema() {
        // 1. Limpiar instancia core
        this.core = new TrazabilidadCore();
        
        // 2. Limpiar gráficos
        if (this.chart1) {
            this.chart1.destroy();
            this.chart1 = null;
        }
        if (this.chart2) {
            this.chart2.destroy();
            this.chart2 = null;
        }
        
        // 3. Limpiar selección de materiales
        const materialsContainer = document.getElementById('materialsContainer');
        if (materialsContainer) {
            materialsContainer.innerHTML = '';
        }
        
        // 4. Ocultar secciones
        const materialsSection = document.getElementById('materialsSection');
        const reportSection = document.getElementById('reportSection');
        if (materialsSection) materialsSection.classList.add('hidden');
        if (reportSection) reportSection.classList.add('hidden');
        
        // 5. Limpiar inputs y selects
        const fileInput = document.getElementById('fileInput');
        const filterCentro = document.getElementById('filterCentro');
        const filterMaterial = document.getElementById('filterMaterial');
        
        if (fileInput) fileInput.value = '';
        if (filterCentro) {
            filterCentro.innerHTML = '<option value="">-- Todos --</option>';
        }
        if (filterMaterial) filterMaterial.value = '';
        
        // 6. Deshabilitar botones
        document.getElementById('listMaterialsBtn').disabled = true;
        document.getElementById('configStockBtn').disabled = true;
        document.getElementById('generateBtn').disabled = true;
        document.getElementById('downloadExcelBtn').disabled = true;
        
        // 7. Cerrar modal si está abierto
        this.closeModal();
        
        // 8. Mostrar confirmación
        this.showCustomAlert('Sistema reiniciado correctamente. Puedes cargar un nuevo archivo Excel.', 'success');
        
        console.log('Sistema reiniciado completamente');
    }

    initializeTrazabilidadLogic() {
        let modalEventsInitialized = false;

        const initializeModalEvents = () => {
            if (modalEventsInitialized) return;
            
            // Eventos del modal de stock - CORREGIDOS CON EVENT LISTENERS DIRECTOS
            document.getElementById('closeStockBtnTop').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.closeModal();
            }.bind(this));

            document.getElementById('closeStockBtn').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                this.closeModal();
            }.bind(this));

            document.getElementById('saveStockBtn').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Botón Guardar clickeado'); // Debug
                
                const wrappers = document.getElementById('stockModalBody').querySelectorAll('div[data-key]');
                let hasChanges = false;
                
                wrappers.forEach(w => {
                    const key = w.dataset.key;
                    const dateInput = w.querySelector('input[type="date"]');
                    const stockInput = w.querySelector('input[type="number"]');
                    
                    if (!key) return;
                    
                    const newDate = dateInput.value;
                    const newStock = parseFloat(stockInput.value || 0);
                    
                    // Solo actualizar si hay cambios
                    if (!this.core.initialStocks[key] || 
                        this.core.initialStocks[key].date !== newDate || 
                        this.core.initialStocks[key].stock !== newStock) {
                        
                        this.core.initialStocks[key] = { 
                            date: newDate, 
                            stock: newStock 
                        };
                        hasChanges = true;
                        console.log(`Stock actualizado para ${key}:`, {date: newDate, stock: newStock}); // Debug
                    }
                });
                
                this.closeModal();
                
                // Mostrar mensaje solo si hubo cambios
                if (hasChanges) {
                    this.showCustomAlert('Stocks iniciales guardados correctamente.', 'success');
                } else {
                    this.showCustomAlert('No se detectaron cambios en los stocks.', 'info');
                }
            }.bind(this));

            // Cerrar modal al hacer click fuera del contenido
            document.getElementById('stockModal').addEventListener('click', function(e) {
                if (e.target.id === 'stockModal') {
                    this.closeModal();
                }
            }.bind(this));
            
            // Prevenir que el clic dentro del modal cierre el modal
            const modalContent = document.querySelector('.modal-content');
            if (modalContent) {
                modalContent.addEventListener('click', function(e) {
                    e.stopPropagation();
                });
            }
            
            modalEventsInitialized = true;
        };

        // File load
        document.getElementById('fileInput').addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    const data = new Uint8Array(ev.target.result);
                    const wb = XLSX.read(data, {type:'array'});
                    const firstSheetName = wb.SheetNames[0];
                    const ws = wb.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json(ws, {defval:''});
                    this.core.rawRows = json.map(r => this.core.transformRow(r));
                    if (!this.core.rawRows.length) { 
                        this.showCustomAlert('No se detectaron filas en el archivo.', 'warning');
                        return; 
                    }
                    this.core.populateMaterialList(this.core.rawRows);
                    
                    // Fill filterCentro
                    const filterCentro = document.getElementById('filterCentro');
                    filterCentro.innerHTML = '<option value="">-- Todos --</option>';
                    Array.from(this.core.centroSet).sort().forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c;
                        opt.textContent = c;
                        filterCentro.appendChild(opt);
                    });
                    
                    document.getElementById('listMaterialsBtn').disabled = false;
                    document.getElementById('configStockBtn').disabled = false;
                    document.getElementById('generateBtn').disabled = false;
                    document.getElementById('downloadExcelBtn').disabled = true;
                } catch(err) {
                    console.error(err);
                    this.showCustomAlert('Error leyendo archivo: ' + err.message, 'error');
                }
            }.bind(this);
            reader.readAsArrayBuffer(f);
        });

        // Render materials list
        document.getElementById('listMaterialsBtn').addEventListener('click', () => {
            const materialsContainer = document.getElementById('materialsContainer');
            const materialsSection = document.getElementById('materialsSection');
            
            materialsContainer.innerHTML = '';
            materialsSection.classList.remove('hidden');
            
            const centroFilter = document.getElementById('filterCentro').value;
            const matFilter = (document.getElementById('filterMaterial').value || '').toLowerCase();

            this.core.uniqueMaterials.forEach(u => {
                if (centroFilter && u.centro !== centroFilter) return;
                if (matFilter && !(String(u.material).toLowerCase().includes(matFilter) || 
                    String(u.texto).toLowerCase().includes(matFilter))) return;

                const item = document.createElement('div');
                item.className = 'material-item';
                item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 15px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 10px;';
                
                const left = document.createElement('div');
                left.style.cssText = 'display: flex; align-items: center; gap: 10px;';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'material-checkbox';
                cb.dataset.key = u.key;
                cb.checked = true;
                cb.style.cssText = 'width: 18px; height: 18px;';
                
                const span = document.createElement('div');
                span.textContent = `${u.material} — ${u.texto} (${u.centro})`;
                span.style.cssText = 'color: var(--text);';
                
                left.appendChild(cb);
                left.appendChild(span);

                const right = document.createElement('div');
                const editBtn = document.createElement('button');
                editBtn.textContent = 'Editar stock inicial';
                editBtn.className = 'alt';
                editBtn.style.cssText = 'padding: 8px 12px; font-size: 0.8rem;';
                editBtn.addEventListener('click', () => this.openStockModalForKeys([u.key]));
                
                right.appendChild(editBtn);
                item.appendChild(left);
                item.appendChild(right);
                materialsContainer.appendChild(item);
            });

            document.getElementById('generateBtn').disabled = false;
            document.getElementById('configStockBtn').disabled = false;
        });

        // Select all / clear all
        document.getElementById('selectAllBtn').addEventListener('click', () => {
            document.querySelectorAll('.material-checkbox').forEach(cb => cb.checked = true);
        });
        
        document.getElementById('clearAllBtn').addEventListener('click', () => {
            document.querySelectorAll('.material-checkbox').forEach(cb => cb.checked = false);
        });

        // Config stock initial
        document.getElementById('configStockBtn').addEventListener('click', () => {
            const checked = Array.from(document.querySelectorAll('.material-checkbox:checked')).map(c => c.dataset.key);
            if (checked.length === 0) {
                this.openStockModalForKeys(this.core.uniqueMaterials.map(u => u.key));
            } else {
                this.openStockModalForKeys(checked);
            }
        });

        // Generate report - CON ALERT DE ÉXITO
        document.getElementById('generateBtn').addEventListener('click', () => {
            const checked = Array.from(document.querySelectorAll('.material-checkbox:checked')).map(c => c.dataset.key);
            if (checked.length === 0) { 
                this.showCustomAlert('Selecciona al menos un material.', 'warning');
                return; 
            }
            
            const missing = checked.filter(k => !this.core.initialStocks[k]);
            if (missing.length > 0) {
                this.showCustomAlert('Falta stock inicial para algunos materiales. Se usarán valores de 0.', 'warning');
                missing.forEach(k => this.core.initialStocks[k] = { 
                    date: this.core.getOldestDateForKey(k) ? this.core.getOldestDateForKey(k).toISOString().slice(0,10) : (new Date().toISOString().slice(0,10)), 
                    stock: 0 
                });
            }
            
            this.core.results = checked.map(k => this.core.analyzeKey(k)).filter(Boolean);
            this.renderResults(this.core.results);
            
            const reportSection = document.getElementById('reportSection');
            reportSection.classList.remove('hidden');
            
            document.getElementById('materialsAnalizados').textContent = this.core.results.map(r => `${r.material} (${r.centro})`).join(', ');
            document.getElementById('downloadExcelBtn').disabled = false;
            
            // ALERT DE ÉXITO - Reporte generado
            this.showCustomAlert(`Reporte generado exitosamente. Se analizaron ${this.core.results.length} materiales.`, 'success');
        });

        // Download Excel - CON ALERT DE ÉXITO
        document.getElementById('downloadExcelBtn').addEventListener('click', () => {
            if (!this.core.results || this.core.results.length === 0) { 
                this.showCustomAlert('Genera el reporte primero.', 'warning');
                return; 
            }
            
            const out = this.core.results.map(r => {
                // Obtener todos los errores
                const todasIrregularidades = r.irregularidadesAll || [];
                
                // Crear strings con todos los errores
                const todosTipos = todasIrregularidades.map(i => i.tipo).join('; ');
                const todosUsuarios = todasIrregularidades.map(i => i.usuario).join('; ');
                const todasDescripciones = todasIrregularidades.map(i => i.descripcion).join(' | ');
                
                return {
                    Material: r.material,
                    Texto: r.texto,
                    UMB: r.umb,
                    Centro: r.centro,
                    Tienda: r.tienda,
                    Rango_fecha: r.rangoFecha,
                    Ultimo_ingreso: r.ultimoIngreso,
                    'Ajustes (+ / -)': r.ajustes,
                    Usuarios_Ajuste: r.usuariosAjuste || '-', // NUEVA COLUMNA EN EXCEL
                    Fecha_ajuste: r.fechaAjuste,
                    Puntos_cero: r.puntosCero,
                    Posible_irregularidad: todasIrregularidades.length > 0 ? todosTipos : '-',
                    Usuario_irregularidad: todasIrregularidades.length > 0 ? todosUsuarios : '-',
                    Descripcion_irregularidad: todasIrregularidades.length > 0 ? todasDescripciones : '-',
                    Tipo_diferencia: r.tipoDiferencia,
                    Total_salidas_tienda: r.totalSalidasTienda,
                    Total_salidas_clientes: r.totalSalidasClientes,
                    Salida_max_tienda: r.salidaMaxTienda,
                    Salida_min_tienda: r.salidaMinTienda,
                    Salida_max_clientes: r.salidaMaxClientes,
                    Salida_min_clientes: r.salidaMinClientes,
                    Promedio_salida_tienda: r.promedioSalidaTienda,
                    Promedio_salida_cliente: r.promedioSalidaCliente,
                    Stock_Actual: r.stockActual
                };
            });
            
            const ws = XLSX.utils.json_to_sheet(out);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
            XLSX.writeFile(wb, 'reporte_trazabilidad.xlsx');
            
            // ALERT DE ÉXITO - Excel descargado
            this.showCustomAlert('Excel descargado correctamente. El archivo "reporte_trazabilidad.xlsx" se ha guardado en tu dispositivo.', 'success');
        });

        // Reiniciar sistema
        document.getElementById('reiniciarBtn').addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            this.showCustomConfirm(
                '¿Estás seguro de que quieres reiniciar el sistema? Se perderán todos los datos y configuraciones actuales.',
                // Callback para Aceptar
                () => {
                    this.reiniciarSistema();
                },
                // Callback para Cancelar (no hace nada)
                () => {
                    console.log('Reinicio cancelado por el usuario');
                }
            );
        }.bind(this));

        // Inicializar eventos del modal
        initializeModalEvents();
    }

    openStockModalForKeys(keys) {
        const stockModalBody = document.getElementById('stockModalBody');
        stockModalBody.innerHTML = '';
        
        const toEdit = keys.map(k => this.core.uniqueMaterials.find(u => u.key === k)).filter(Boolean);
        if (toEdit.length === 0) { 
            this.showCustomAlert('No hay materiales seleccionados.', 'warning');
            return; 
        }

        toEdit.forEach(m => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);';
            wrapper.dataset.key = m.key;
            
            const h = document.createElement('h6');
            h.textContent = `${m.material} — ${m.texto} (${m.centro})`;
            h.style.cssText = 'color: var(--text); margin-bottom: 15px; font-size: 1rem;';
            
            const dateLabel = document.createElement('label');
            dateLabel.textContent = 'Fecha del stock inicial:';
            dateLabel.style.cssText = 'display: block; color: var(--muted); font-size: 0.85rem; margin-bottom: 5px;';
            
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.style.cssText = 'width: 100%; padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: var(--text); margin-bottom: 15px; font-size: 1rem;';
            
            const oldest = this.core.getOldestDateForKey(m.key);
            dateInput.value = oldest ? oldest.toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
            
            const stockLabel = document.createElement('label');
            stockLabel.textContent = 'Stock inicial:';
            stockLabel.style.cssText = 'display: block; color: var(--muted); font-size: 0.85rem; margin-bottom: 5px;';
            
            const stockInput = document.createElement('input');
            stockInput.type = 'number';
            stockInput.step = '0.01';
            stockInput.min = '0';
            stockInput.style.cssText = 'width: 100%; padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: var(--text); font-size: 1rem;';
            
            if (this.core.initialStocks[m.key]) { 
                stockInput.value = this.core.initialStocks[m.key].stock; 
                dateInput.value = this.core.initialStocks[m.key].date; 
            } else {
                stockInput.value = '0';
            }
            
            wrapper.appendChild(h);
            wrapper.appendChild(dateLabel);
            wrapper.appendChild(dateInput);
            wrapper.appendChild(stockLabel);
            wrapper.appendChild(stockInput);
            stockModalBody.appendChild(wrapper);
        });

        this.openModal();
    }

    renderResults(resultsArr) {
        const reportBody = document.getElementById('reportBody');
        const dateRangeSpan = document.getElementById('reportMeta');
        
        reportBody.innerHTML = '';
        dateRangeSpan.textContent = `Rango de fechas: ${resultsArr.map(r => r.rangoFecha).join(' | ')}`;
        
        resultsArr.forEach(r => {
            const tr = document.createElement('tr');
            
            const td = (txt, cls = '') => {
                const cell = document.createElement('td');
                cell.textContent = (txt === null || txt === undefined) ? '' : txt;
                if (cls) cell.classList.add(cls);
                return cell;
            };

            // Obtener todos los errores
            const todasIrregularidades = r.irregularidadesAll || [];
            
            // Crear strings con todos los errores
            const todosTipos = todasIrregularidades.map(i => i.tipo).join('; ');
            const todosUsuarios = todasIrregularidades.map(i => i.usuario).join('; ');
            const todasDescripciones = todasIrregularidades.map(i => i.descripcion).join(' | ');
            
            tr.appendChild(td(r.material));
            tr.appendChild(td(r.texto));
            tr.appendChild(td(r.umb));
            tr.appendChild(td(r.centro));
            tr.appendChild(td(r.tienda));
            tr.appendChild(td(r.rangoFecha));
            tr.appendChild(td(r.ultimoIngreso));
            tr.appendChild(td(r.ajustes));
            tr.appendChild(td(r.usuariosAjuste)); // NUEVA CELDA - Usuarios de ajuste
            tr.appendChild(td(r.fechaAjuste));
            tr.appendChild(td(r.puntosCero));
            
            // Mostrar TODOS los tipos de irregularidad
            tr.appendChild(td(todasIrregularidades.length > 0 ? todosTipos : '-'));
            
            // Mostrar TODOS los usuarios de irregularidad
            tr.appendChild(td(todasIrregularidades.length > 0 ? todosUsuarios : '-'));
            
            // Mostrar TODAS las descripciones de irregularidad
            tr.appendChild(td(todasIrregularidades.length > 0 ? todasDescripciones : '-'));
            
            tr.appendChild(td(r.tipoDiferencia));
            tr.appendChild(td(Math.abs(r.totalSalidasTienda), 'negative-diff'));
            tr.appendChild(td(Math.abs(r.totalSalidasClientes), 'negative-diff'));
            tr.appendChild(td(r.salidaMaxTienda));
            tr.appendChild(td(r.salidaMinTienda));
            tr.appendChild(td(r.salidaMaxClientes));
            tr.appendChild(td(r.salidaMinClientes));
            tr.appendChild(td(r.promedioSalidaTienda));
            tr.appendChild(td(r.promedioSalidaCliente));
            
            const stockTd = td(this.core.round2(r.stockActual));
            stockTd.classList.add(r.stockActual < 0 ? 'negative-diff' : 'positive-diff');
            tr.appendChild(stockTd);
            
            reportBody.appendChild(tr);
        });

        this.renderCharts(resultsArr);
    }

    renderCharts(resultsArr) {
        // Destruir gráficos anteriores
        if (this.chart1) this.chart1.destroy();
        if (this.chart2) this.chart2.destroy();

        // Configuración común para texto blanco
        const whiteTextConfig = {
            color: '#ffffff',
            font: {
                family: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
            }
        };

        // Gráfico 1: Tipos de Movimiento por Destino (Barras 3D) - MEJORADO
        const movementTypesData = this.core.getMovementTypesData(resultsArr);
        const ctx1 = document.getElementById('chartMovimientos');
        if (ctx1 && movementTypesData.length > 0) {
            const topMovements = movementTypesData.slice(0, 8); // Mostrar hasta 8 tipos
            
            this.chart1 = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: topMovements.map(m => `Mov. ${m.type}`),
                    datasets: [
                        {
                            label: 'Salidas Tienda',
                            data: topMovements.map(m => m.tienda),
                            backgroundColor: 'rgba(33, 150, 243, 0.9)',
                            borderColor: 'rgba(33, 150, 243, 1)',
                            borderWidth: 2,
                            borderRadius: 8,
                            borderSkipped: false,
                        },
                        {
                            label: 'Salidas Clientes',
                            data: topMovements.map(m => m.cliente),
                            backgroundColor: 'rgba(76, 175, 80, 0.9)',
                            borderColor: 'rgba(76, 175, 80, 1)',
                            borderWidth: 2,
                            borderRadius: 8,
                            borderSkipped: false,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                boxWidth: 12,
                                font: { 
                                    size: 12,
                                    weight: 'bold'
                                },
                                color: '#ffffff', // Texto blanco
                                padding: 15
                            }
                        },
                        title: {
                            display: true,
                            text: 'TIPOS DE MOVIMIENTO POR DESTINO',
                            color: '#ffffff', // Texto blanco
                            font: {
                                size: 14,
                                weight: 'bold'
                            },
                            padding: {
                                bottom: 20
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.9)',
                            titleFont: { 
                                size: 13, 
                                weight: 'bold',
                                color: '#ffffff'
                            },
                            bodyFont: { 
                                size: 12,
                                color: '#ffffff'
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.raw || 0;
                                    return `${label}: ${value.toLocaleString()}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { 
                                display: false,
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: { 
                                font: { 
                                    size: 11,
                                    weight: 'bold'
                                },
                                color: '#ffffff', // Texto blanco
                                maxRotation: 45,
                                minRotation: 45
                            }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { 
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: { 
                                font: { 
                                    size: 11 
                                },
                                color: '#ffffff', // Texto blanco
                                callback: function(value) {
                                    return value.toLocaleString();
                                }
                            }
                        }
                    },
                    animation: {
                        duration: 1000,
                        easing: 'easeOutQuart'
                    }
                }
            });
        }

        // Gráfico 2: Distribución Total de Salidas (Dona 3D) - COMPLETAMENTE VISIBLE
        const ctx2 = document.getElementById('chartDistribucion');
        if (ctx2) {
            const totalSalidasTienda = resultsArr.reduce((sum, r) => sum + Math.abs(r.totalSalidasTienda), 0);
            const totalSalidasClientes = resultsArr.reduce((sum, r) => sum + Math.abs(r.totalSalidasClientes), 0);

            this.chart2 = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: ['Salidas Tienda', 'Salidas Clientes'],
                    datasets: [{
                        data: [totalSalidasTienda, totalSalidasClientes],
                        backgroundColor: [
                            'rgba(255, 193, 7, 0.9)',
                            'rgba(156, 39, 176, 0.9)'
                        ],
                        borderColor: [
                            'rgba(255, 193, 7, 1)',
                            'rgba(156, 39, 176, 1)'
                        ],
                        borderWidth: 3,
                        borderRadius: 6,
                        spacing: 2,
                        borderAlign: 'inner'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%', // Reducido para que el anillo sea más grueso y visible
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 15,
                                font: { 
                                    size: 12,
                                    weight: 'bold'
                                },
                                color: '#ffffff', // Texto blanco
                                padding: 15,
                                generateLabels: function(chart) {
                                    const data = chart.data;
                                    if (data.labels.length && data.datasets.length) {
                                        return data.labels.map((label, i) => {
                                            const value = data.datasets[0].data[i];
                                            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                            
                                            return {
                                                text: `${label}: ${value.toLocaleString()} (${percentage}%)`,
                                                fillStyle: data.datasets[0].backgroundColor[i],
                                                strokeStyle: data.datasets[0].borderColor[i],
                                                lineWidth: 2,
                                                hidden: false,
                                                index: i
                                            };
                                        });
                                    }
                                    return [];
                                }
                            }
                        },
                        title: {
                            display: true,
                            text: 'DISTRIBUCIÓN TOTAL DE SALIDAS',
                            color: '#ffffff', // Texto blanco
                            font: {
                                size: 14,
                                weight: 'bold'
                            },
                            padding: {
                                bottom: 20
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.9)',
                            titleFont: { 
                                size: 13, 
                                weight: 'bold',
                                color: '#ffffff'
                            },
                            bodyFont: { 
                                size: 12,
                                color: '#ffffff'
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = Math.round((value / total) * 100);
                                    return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    animation: {
                        animateScale: true,
                        animateRotate: true,
                        duration: 1000,
                        easing: 'easeOutQuart'
                    },
                    layout: {
                        padding: {
                            top: 10,
                            bottom: 10,
                            left: 10,
                            right: 10
                        }
                    }
                }
            });
        }
    }
}

window.TrazabilidadSystem = TrazabilidadSystem;

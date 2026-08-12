// js/modules-manager.js - Gestor central de módulos
class ModulesManager {
    constructor() {
        this.modules = new Map();
        this.currentModule = null;
        this.container = null;
        this.currentModuleId = null;
    }

    init(container) {
        this.container = container;
        this.registerCoreModules();
        // Kacosa App: este módulo solo se abre desde "Inventario > Trazabilidad"
        // en el menú del shell, así que la intención ya está clara — se entra
        // directo a Trazabilidad en vez de mostrar una pantalla para elegir
        // entre módulos (Análisis de Pedidos sigue sin implementarse).
        this.loadModule('trazabilidad');
    }

    registerCoreModules() {
        // Registrar módulo de Trazabilidad
        this.registerModule('trazabilidad', {
            name: 'Trazabilidad',
            description: 'Análisis de movimientos de inventario',
            icon: '📊',
            instance: null,
            init: () => {
                if (typeof TrazabilidadSystem === 'undefined') {
                    console.error('TrazabilidadSystem no está disponible');
                    this.showError('El sistema de trazabilidad no está cargado');
                    return null;
                }
                return new TrazabilidadSystem(this.container);
            }
        });

        // Registrar módulo de Análisis de Pedidos (futuro)
        this.registerModule('analisis-pedidos', {
            name: 'Análisis de Pedidos',
            description: 'Próximamente...',
            icon: '📦',
            instance: null,
            init: () => this.showComingSoon('Análisis de Pedidos')
        });
    }

    registerModule(id, moduleConfig) {
        this.modules.set(id, moduleConfig);
        console.log(`Módulo registrado: ${id}`);
    }

    showMainMenu() {
        this.container.innerHTML = `
            <div class="reports-menu">
                ${Array.from(this.modules.values()).map(module => `
                    <div class="report-option" data-module="${this.getModuleId(module)}">
                        <div class="report-icon">${module.icon}</div>
                        <h3>${module.name}</h3>
                        <p>${module.description}</p>
                    </div>
                `).join('')}
            </div>
        `;

        // Event listeners para los módulos
        document.querySelectorAll('.report-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const moduleId = e.currentTarget.dataset.module;
                this.loadModule(moduleId);
            });
        });

        this.currentModuleId = null;
    }

    getModuleId(module) {
        for (let [id, mod] of this.modules) {
            if (mod === module) return id;
        }
        return null;
    }

    loadModule(moduleId) {
        const module = this.modules.get(moduleId);
        if (!module) {
            this.showError('Módulo no encontrado');
            return;
        }

        // Limpiar módulo anterior
        if (this.currentModule && typeof this.currentModule.destroy === 'function') {
            this.currentModule.destroy();
        }

        // Inicializar nuevo módulo
        try {
            this.currentModule = module.init();
            this.currentModuleId = moduleId;
            
            // Si el módulo tiene método init, llamarlo
            if (this.currentModule && typeof this.currentModule.init === 'function') {
                this.currentModule.init();
            }
        } catch (error) {
            console.error('Error al inicializar módulo:', error);
            this.showError(`Error al cargar el módulo: ${error.message}`);
        }
    }

    showComingSoon(moduleName) {
        this.container.innerHTML = `
            <div class="coming-soon-container">
                <button class="back-button" id="backToMainMenu">← Volver a Reportes</button>
                <div class="coming-soon">
                    <div class="coming-soon-icon">🚧</div>
                    <h2>${moduleName}</h2>
                    <p>Esta funcionalidad estará disponible próximamente</p>
                    <button id="returnToMenu" class="alt">← Volver atrás</button>
                </div>
            </div>
        `;

        document.getElementById('backToMainMenu').addEventListener('click', () => {
            this.showMainMenu();
        });

        document.getElementById('returnToMenu').addEventListener('click', () => {
            this.showMainMenu();
        });

        this.currentModuleId = null;
    }

    showError(message) {
        this.container.innerHTML = `
            <div class="error-message">
                <div class="error-icon">❌</div>
                <h3>Error</h3>
                <p>${message}</p>
                <button id="retryButton" class="alt">Volver al Menú</button>
            </div>
        `;

        document.getElementById('retryButton').addEventListener('click', () => {
            this.showMainMenu();
        });

        this.currentModuleId = null;
    }

    // Método para obtener el módulo actual
    getCurrentModule() {
        return this.currentModule;
    }

    // Método para obtener el ID del módulo actual
    getCurrentModuleId() {
        return this.currentModuleId;
    }
}

// Hacerlo global para acceso fácil
window.ModulesManager = ModulesManager;

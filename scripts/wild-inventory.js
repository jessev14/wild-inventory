const moduleID = 'wild-inventory';

const lg = x => console.log(x);

const defaultSections = ["weapon", "equipment", "consumable", "tool", "backpack", "loot"];
const defaultFlagData = [];


Hooks.once('init', () => {
    libWrapper.register(moduleID, 'game.dnd5e.applications.actor.ActorSheet5e.prototype.getData', getData, 'WRAPPER');
    libWrapper.register(moduleID, 'ActorSheet.prototype._onDropItem', _onDropItem, 'OVERRIDE');
    libWrapper.register(moduleID, 'CONFIG.Actor.documentClass.prototype._prepareEncumbrance', _prepareEncumbrance, 'OVERRIDE');
});

Hooks.once('ready', () => {
    for (const section of defaultSections) {
        defaultFlagData.push({
            id: section,
            label: `${CONFIG.Item.typeLabels[section]}Pl`,
            dataset: { type: section }
        });
    }
});


Hooks.on('renderDocumentSheetConfig', (app, [html], appData) => {
    const actor = app.object;
    if (actor.documentName !== 'Actor') return;

    const resetSections = document.createElement('div');
    resetSections.classList.add('form-group');
    resetSections.innerHTML = `
        <label>Inventory Sections</label>
        <button type="button">Reset to Default</button>
    `;
    resetSections.onclick = () => {
        return Dialog.confirm({
            title: 'Reset Inventory Sections to Default?',
            yes: () => actor.setFlag(moduleID, 'inventorySections', defaultFlagData)
        });
    };
    html.querySelector('button').before(resetSections);
    app.setPosition({ height: 'auto' });

});

Hooks.on('renderActorSheet', (app, [html], appData) => {
    const { actor } = app;
    if (actor.type !== 'character') return;
    
    const inventorySections = actor.getFlag(moduleID, 'inventorySections');

    const inventoryTab = html.querySelector('div.tab.inventory');

    const addSectionButton = document.createElement('a');
    addSectionButton.style = 'flex: 0; padding: 0 5px;';
    addSectionButton.innerHTML = '<i class="fas fa-plus"></i> Add Section';
    addSectionButton.onclick = () => {
        new Dialog({
            title: 'Add Inventory Section',
            content: `
                <input type="text" placeholder="New Section Name" />
            `,
            buttons: {
                confirm: {
                    label: 'Confirm',
                    icon: '<i class="fas fa-check"></i>',
                    callback: ([html]) => {
                        const nameInput = html.querySelector('input');
                        const newSectionName = nameInput.value;
                        if (inventorySections.find(s => s.id === newSectionName)) {
                            return ui.notifications.warn('Inventory section with that name already exists.');
                        }

                        inventorySections.push({ id: newSectionName, label: newSectionName });
                        return actor.setFlag(moduleID, 'inventorySections', inventorySections);
                    }
                },
                cancel: {
                    label: 'Cancel',
                    icon: '<i class="fas fa-times"></i>'
                }
            },
            default: 'confirm'
        }).render(true);
    };
    const itemsList = inventoryTab.querySelector('ol.items-list.inventory-list');
    itemsList.before(addSectionButton);

    for (const [idx, sectionHeader] of inventoryTab.querySelectorAll('li.items-header').entries()) {
        const inventorySection = inventorySections[idx];
        sectionHeader.dataset.sectionId = inventorySection.id;

        if (!inventorySection.dataset) sectionHeader.querySelector('a.item-create').remove();

        const configureSectionButton = document.createElement('a');
        configureSectionButton.dataset.tooltip = 'Configure Section';
        configureSectionButton.innerHTML = '<i class="fas fa-cog"></i>';
        configureSectionButton.style = 'flex: 0; margin-right: 10px;';
        configureSectionButton.onclick = () => new SectionConfiguration(inventorySection, actor).render(true);
        sectionHeader.querySelector('h3.item-name').after(configureSectionButton);

        const removeSectionButton = document.createElement('a');
        removeSectionButton.dataset.tooltip = 'Delete Section';
        removeSectionButton.innerHTML = '<i class="fa-regular fa-minus"></i>';
        removeSectionButton.style = 'flex: 0; margin-right: 10px;';
        removeSectionButton.onclick = async () => {
            if (appData.items.find(i => i.getFlag(moduleID, 'customInventorySection') === inventorySection.id)) {
                return ui.notifications.warn('Can only delete empty sections.');
            }

            return Dialog.confirm({
                title: `Delete Section?`,
                yes: () => {
                    inventorySections.splice(idx, 1);
                    return actor.setFlag(moduleID, 'inventorySections', inventorySections);
                }
            });
        };
        configureSectionButton.after(removeSectionButton);

        for (const direction of ['up', 'down']) {
            const directionButton = document.createElement('a');
            directionButton.dataset.tooltip = `Move section ${direction}`;
            directionButton.innerHTML = `<i class="fa-solid fa-angle-${direction}"></i>`
            directionButton.style = 'flex: 0; margin-right: 10px;';
            directionButton.onclick = () => {
                if (idx === 0 && direction === 'up') return;

                arraymove(inventorySections, idx, idx - (direction === 'up' ? 1 : -1));
                return actor.setFlag(moduleID, 'inventorySections', inventorySections)
            };
            configureSectionButton.before(directionButton);
        }

        function arraymove(arr, fromIndex, toIndex) {
            var element = arr[fromIndex];
            arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, element);
        }
    }
});

Hooks.on('preUpdateItem', (item, diff, options, userID) => {
    const newSection = diff.flags?.[moduleID]?.customInventorySection;
    if (!newSection) return;

    const { actor } = item;
    const inventorySections = actor.getFlag(moduleID, 'inventorySections');
    const section = inventorySections.find(s => s.id === newSection);
    const { maxWeight } = section;
    if (!maxWeight) return;

    const currentWeight = actor.items.reduce((acc, current) => {
        if (current.getFlag(moduleID, 'customInventorySection') !== newSection) return acc;
        return acc + ((current.system.weight || 0) * (current.system.quantity || 0));
    }, 0);
    const newWeight = currentWeight + ((item.system.weight || 0) * (item.system.quantity || 0));
    if (newWeight > maxWeight) {
        ui.notifications.warn('Section weight limit reached.');
        return false;
    }
});


async function getData(wrapped, options) {
    const data = await wrapped(options);
    const { actor } = data;
    if (actor.type !== 'character') return data;

    const inventoryItems = [];
    for (const itemType of data.inventory) {
        for (const item of itemType.items) {
            if (!item.getFlag(moduleID, 'customInventorySection')) await item.setFlag(moduleID, 'customInventorySection', item.type);
            inventoryItems.push(item);
        }
    }

    if (!actor.flags[moduleID]?.inventorySections) await actor.setFlag(moduleID, 'inventorySections', defaultFlagData);
    const inventorySections = actor.getFlag(moduleID, 'inventorySections');

    data.inventory = [];
    for (const section of inventorySections) {
        let label = section.labelOverride || game.i18n.localize(section.label);
        const items = inventoryItems.filter(i => i.getFlag(moduleID, 'customInventorySection') === section.id).sort((a, b) => { return (a.sort || 0) - (b.sort || 0) });
        if (section.maxWeight) {
            const currentWeight = items.reduce((acc, current) => {
                return acc + (current.system.weight || 0);
            }, 0);
            label += ` (${currentWeight}/${section.maxWeight} lbs.)`;
        }
        const currentSection = {
            label,
            items 
        };
        if (section.dataset) currentSection.dataset = { type: section.id };

        data.inventory.push(currentSection);
    }

    return data;
}

async function _onDropItem(event, data) {
    const itemsHeader = event.target.closest('li.items-header');
    const itemLi = event.target.closest('li.item');

    const targetSection = itemsHeader ? itemsHeader : itemLi?.parentElement.previousElementSibling;
    const sectionID = targetSection?.dataset.sectionId;

    if (!this.actor.isOwner) return false;
    const item = await Item.implementation.fromDropData(data);
    const itemData = item.toObject();
    if (!sectionID && !['background', 'class', 'subclass', 'spell', 'feat'].includes(itemData.type)) return ui.notifications.warn('Drop item onto inventory section.');

    // Handle item sorting within the same Actor
    if (this.actor.uuid === item.parent?.uuid) {
        if (item.getFlag(moduleID, 'customInventorySection') === sectionID) return this._onSortItem(event, itemData);

        return item.setFlag(moduleID, 'customInventorySection', sectionID);
    }

    // Create the owned item
    if (sectionID) itemData.flags[moduleID] = { customInventorySection: sectionID };
    return this._onDropItemCreate(itemData);
}

function _prepareEncumbrance() {
    const encumbrance = this.system.attributes.encumbrance ??= {};

    // Get the total weight from items
    const physicalItems = ["weapon", "equipment", "consumable", "tool", "backpack", "loot"];
    let weight = this.items.reduce((weight, i) => {
        if (!physicalItems.includes(i.type)) return weight;

        const sectionID = i.getFlag(moduleID, 'customInventorySection');
        const inventorySections = this.getFlag(moduleID, 'inventorySections');
        if (inventorySections) {
            const section = inventorySections.find(s => s.id === sectionID);
            if (section?.weightLimit) return weight;
        }

        const q = i.system.quantity || 0;
        const w = i.system.weight || 0;
        return weight + (q * w);
    }, 0);

    // [Optional] add Currency Weight (for non-transformed actors)
    const currency = this.system.currency;
    if (game.settings.get("dnd5e", "currencyWeight") && currency) {
        const numCoins = Object.values(currency).reduce((val, denom) => val + Math.max(denom, 0), 0);
        const currencyPerWeight = game.settings.get("dnd5e", "metricWeightUnits")
            ? CONFIG.DND5E.encumbrance.currencyPerWeight.metric
            : CONFIG.DND5E.encumbrance.currencyPerWeight.imperial;
        weight += numCoins / currencyPerWeight;
    }

    // Determine the Encumbrance size class
    let mod = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 4, grg: 8 }[this.system.traits.size] || 1;
    if (this.flags.dnd5e?.powerfulBuild) mod = Math.min(mod * 2, 8);

    const strengthMultiplier = game.settings.get("dnd5e", "metricWeightUnits")
        ? CONFIG.DND5E.encumbrance.strMultiplier.metric
        : CONFIG.DND5E.encumbrance.strMultiplier.imperial;

    // Populate final Encumbrance values
    encumbrance.value = weight.toNearest(0.1);
    encumbrance.max = ((this.system.abilities.str?.value ?? 10) * strengthMultiplier * mod).toNearest(0.1);
    encumbrance.pct = Math.clamped((encumbrance.value * 100) / encumbrance.max, 0, 100);
    encumbrance.encumbered = encumbrance.pct > (200 / 3);

}


export class SectionConfiguration extends FormApplication {
    constructor(object, actor) {
        super(object);

        this.sectionID = object.id;
        this.actor = actor;
    }

    get template() {
        return `modules/${moduleID}/templates/section-configuration.hbs`;
    }

    get title() {
        return `Configure Section: ${this.object.id}`;
    }

    getData() {
        return this.object;
    }

    async _updateObject(event, formData) {
        const updateData = foundry.utils.mergeObject(this.object, formData);
        const actorSections = this.actor.getFlag(moduleID, 'inventorySections');
        const newData = actorSections.map(s => s.id !== updateData.id ? s : updateData);
        return this.actor.setFlag(moduleID, 'inventorySections', newData);
    }
}

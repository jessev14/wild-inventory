const moduleID = 'wild-inventory';

const lg = x => console.log(x);

const defaultSections = ["weapon", "equipment", "consumable", "tool", "backpack", "loot"];
const defaultFlagData = [];


Hooks.once('init', () => {
    libWrapper.register(moduleID, 'game.dnd5e.applications.actor.ActorSheet5e.prototype.getData', getData, 'WRAPPER');
    libWrapper.register(moduleID, 'ActorSheet.prototype._onDropItem', _onDropItem, 'OVERRIDE');
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

    for (const li of html.querySelectorAll('li.item')) {
        const item = actor.items.get(li.dataset.itemId);
        if (!item) continue;

        const sectionID = item.getFlag(moduleID, 'customInventorySection');
        const section = inventorySections.find(s => s.id === sectionID);
        if (!section?.weightLimit) continue;

        const itemWeight = item.getFlag(moduleID, 'weight') * item.system.quantity;
        let weightUnit = game.i18n.localize(`DND5E.Abbreviation${game.settings.get("dnd5e", "metricWeightUnits") ? "Kg" : "Lbs"}`);
        weightUnit = weightUnit[0].toUpperCase() + weightUnit.slice(1);
        li.querySelector('div.item-weight').innerText = `[${itemWeight} ${weightUnit}]`;
    }
});

Hooks.on('preUpdateItem', (item, diff, options, userID) => {
    const newSection = diff.flags?.[moduleID]?.customInventorySection;
    const quantityChange = 'quantity' in (diff.system ?? {});
    const weightChange = 'weight' in (diff.system ?? {});

    if (!newSection && !quantityChange && !weightChange) return;

    const { actor } = item;
    const inventorySections = actor.getFlag(moduleID, 'inventorySections');
    const targetSection = newSection || item.getFlag(moduleID, 'customInventorySection');
    if (!inventorySections || !targetSection) return;

    const section = inventorySections.find(s => s.id === targetSection);
    const { maxWeight } = section;
    if (!maxWeight) return;

    const currentWeight = actor.items.reduce((acc, current) => {
        if (current.getFlag(moduleID, 'customInventorySection') !== targetSection) return acc;
        if (current.uuid === item.uuid) return acc;

        return acc + ((current.system.weight || 0) * (current.system.quantity || 0));
    }, 0);
    const newWeight = currentWeight + ((diff.system?.weight ?? (item.system.weight || 0)) * (diff.system?.quantity ?? (item.system.quantity || 0)));
    if (newWeight > maxWeight) {
        ui.notifications.warn('Section weight limit reached.');
        return false;
    }
});

Hooks.on('updateItem', (item, diff, options, userID) => {
    if (userID !== game.user.id) return;
    if (!('customInventorySection' in (diff.flags?.[moduleID] || {}) )) return;
    
    const { actor } = item;
    const sectionID = diff.flags[moduleID].customInventorySection;
    const section = actor.getFlag(moduleID, 'inventorySections')?.find(s => s.id === sectionID);
    if (!section) return;

    const { weightLimit } = section;
    return item.update({
        [`flags.${moduleID}.weight`]: weightLimit ? item.system.weight : null,
        'system.weight': weightLimit ? 0 : item.flags[moduleID].weight
    });
});

Hooks.on('renderItemSheet', (app, [html], appData) => {
    const item = app.object;
    if (!('weight' in (item.flags[moduleID] || {}))) return;

    const weightInput = html.querySelector('input[name="system.weight"]');
    weightInput.value = item.getFlag(moduleID, 'weight');
    weightInput.name = `flags.${moduleID}.weight`;
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
                return acc + ((current.system.weight * current.system.quantity) || 0);
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
        const actorSections = this.actor.getFlag(moduleID, 'inventorySections');
        const sameWL = actorSections.find(s => s.id === this.sectionID).weightLimit !== formData.weightLimit;
        const updateData = foundry.utils.mergeObject(this.object, formData);
        const newData = actorSections.map(s => s.id !== updateData.id ? s : updateData);
        const items = this.actor.items.filter(i => i.getFlag(moduleID, 'customInventorySection') === this.sectionID);
        if (sameWL) {
            for (const item of items) {
                if (formData.weightLimit) {
                    await item.setFlag(moduleID, 'weight', item.system.weight);
                    await item.update({ 'system.weight': 0 })
                } else {
                    await item.update({ 'system.weight': item.getFlag(moduleID, 'weight') });
                    await item.unsetFlag(moduleID, 'weight');
                }
            }
        }
        return this.actor.setFlag(moduleID, 'inventorySections', newData);
    }
}

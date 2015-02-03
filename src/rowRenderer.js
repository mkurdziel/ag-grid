define(["./constants","./svgFactory","./utils"], function(constants, SvgFactory, utils) {

    var svgFactory = new SvgFactory();

    function RowRenderer(gridOptions, rowModel, gridOptionsWrapper, eGrid, angularGrid, $compile, $scope) {
        this.gridOptions = gridOptions;
        this.rowModel = rowModel;
        this.gridOptionsWrapper = gridOptionsWrapper;
        this.angularGrid = angularGrid;
        this.findAllElements(eGrid);
        this.$compile = $compile;
        this.$scope = $scope;

        //done once
        //for virtualisation, maps keep track of which elements are attached to the dom
        this.rowsInBodyContainer = {};
        this.rowsInPinnedContainer = {};
        this.childScopesForRows = {};
    }

    RowRenderer.prototype.setMainRowWidths = function() {
        var mainRowWidth = this.gridOptionsWrapper.getTotalUnpinnedColWidth() + "px";

        var unpinnedRows = this.eBodyContainer.querySelectorAll(".ag-row");
        for (var i = 0; i<unpinnedRows.length; i++) {
            unpinnedRows[i].style.width = mainRowWidth;
        }
    };

    RowRenderer.prototype.findAllElements = function (eGrid) {
        this.eBodyContainer = eGrid.querySelector(".ag-body-container");
        this.eBodyViewport = eGrid.querySelector(".ag-body-viewport");
        this.ePinnedColsContainer = eGrid.querySelector(".ag-pinned-cols-container");
    };

    RowRenderer.prototype.refreshView = function() {
        var rowCount = this.rowModel.getRowsAfterMap().length;
        var containerHeight = this.gridOptionsWrapper.getRowHeight() * rowCount;
        this.eBodyContainer.style.height = containerHeight + "px";
        this.ePinnedColsContainer.style.height = containerHeight + "px";

        this.refreshAllVirtualRows();
    };

    RowRenderer.prototype.refreshAllVirtualRows = function () {
        //remove all current virtual rows, as they have old data
        var rowsToRemove = Object.keys(this.rowsInBodyContainer);
        this.removeVirtualRows(rowsToRemove);

        //add in new rows
        this.drawVirtualRows();
    };

    //takes array of row id's
    RowRenderer.prototype.removeVirtualRows = function (rowsToRemove) {
        var _this = this;
        rowsToRemove.forEach(function (indexToRemove) {
            var pinnedRowToRemove = _this.rowsInPinnedContainer[indexToRemove];
            _this.ePinnedColsContainer.removeChild(pinnedRowToRemove);
            delete _this.rowsInPinnedContainer[indexToRemove];

            var bodyRowToRemove = _this.rowsInBodyContainer[indexToRemove];
            _this.eBodyContainer.removeChild(bodyRowToRemove);
            delete _this.rowsInBodyContainer[indexToRemove];

            var childScopeToDelete = _this.childScopesForRows[indexToRemove];
            if (childScopeToDelete) {
                childScopeToDelete.$destroy();
                delete _this.childScopesForRows[indexToRemove];
            }
        });
    };

    RowRenderer.prototype.drawVirtualRows = function() {
        var topPixel = this.eBodyViewport.scrollTop;
        var bottomPixel = topPixel + this.eBodyViewport.offsetHeight;

        var firstRow = Math.floor(topPixel / this.gridOptionsWrapper.getRowHeight());
        var lastRow = Math.floor(bottomPixel / this.gridOptionsWrapper.getRowHeight());

        //add in buffer
        firstRow = firstRow - constants.ROW_BUFFER_SIZE;
        lastRow = lastRow + constants.ROW_BUFFER_SIZE;

        this.ensureRowsRendered(firstRow, lastRow);
    };

    RowRenderer.prototype.ensureRowsRendered = function (start, finish) {
        var pinnedColumnCount = this.gridOptionsWrapper.getPinnedColCount();
        var mainRowWidth = this.gridOptionsWrapper.getTotalUnpinnedColWidth();
        var _this = this;

        //at the end, this array will contain the items we need to remove
        var rowsToRemove = Object.keys(this.rowsInBodyContainer);

        //add in new rows
        for (var rowIndex = start; rowIndex <= finish; rowIndex++) {
            //see if item already there, and if yes, take it out of the 'to remove' array
            if (rowsToRemove.indexOf(rowIndex.toString()) >= 0) {
                rowsToRemove.splice(rowsToRemove.indexOf(rowIndex.toString()), 1);
                continue;
            }
            //check this row actually exists (in case overflow buffer window exceeds real data)
            var data = this.rowModel.getRowsAfterMap()[rowIndex];
            if (data) {
                _this.insertRow(data, rowIndex, mainRowWidth, pinnedColumnCount);
            }
        }

        //at this point, everything in our 'rowsToRemove' . . .
        this.removeVirtualRows(rowsToRemove);

        //if we are doing angular compiling, then do it here if not in digest
        //this.$scope.$$phase || this.$scope.$apply();
        //if(this.gridOptions.angularCompile && !this.$scope.$$phase) {
        //    this.$scope.$apply();
        //}
    };

    RowRenderer.prototype.insertRow = function(data, rowIndex, mainRowWidth, pinnedColumnCount) {
        //if no cols, don't draw row
        if (!this.gridOptionsWrapper.isColumDefsPresent()) { return; }

        var rowIsAGroup = data._angularGrid_group; //_angularGrid_group is set to true on groups

        var ePinnedRow = this.createRowContainer(rowIndex, data, rowIsAGroup);
        var eMainRow = this.createRowContainer(rowIndex, data, rowIsAGroup);
        var _this = this;

        eMainRow.style.width = mainRowWidth+"px";

        //try compiling as we insert rows
        var newChildScope = this.createChildScopeOrNull(data, rowIndex);

        //if group item, insert the first row
        var columnDefs = this.gridOptionsWrapper.getColumnDefs();
        if (rowIsAGroup) {
            var firstCol = columnDefs[0];
            var groupHeaderTakesEntireRow = this.gridOptionsWrapper.isGroupUseEntireRow();

            var eGroupRow = _this.createGroupElement(data, firstCol, groupHeaderTakesEntireRow, false);
            if (pinnedColumnCount>0) {
                ePinnedRow.appendChild(eGroupRow);
            } else {
                eMainRow.appendChild(eGroupRow);
            }

            if (pinnedColumnCount>0 && groupHeaderTakesEntireRow) {
                var eGroupRowPadding = _this.createGroupElement(data, firstCol, groupHeaderTakesEntireRow, true);
                eMainRow.appendChild(eGroupRowPadding);
            }

            if (!groupHeaderTakesEntireRow) {

                //draw in blank cells for the rest of the row
                var groupHasData = data.aggData!==undefined && data.aggData!==null;
                columnDefs.forEach(function(colDef, colIndex) {
                    if (colIndex==0) { //skip first col, as this is the group col we already inserted
                        return;
                    }
                    var item = null;
                    if (groupHasData) {
                        item = data.aggData[colDef.field];
                    }
                    _this.createCellFromColDef(colDef, item, data, rowIndex, colIndex, pinnedColumnCount, eMainRow, ePinnedRow, newChildScope);
                });
            }

        } else {
            columnDefs.forEach(function(colDef, colIndex) {
                _this.createCellFromColDef(colDef, data[colDef.field], data, rowIndex, colIndex, pinnedColumnCount, eMainRow, ePinnedRow, newChildScope);
            });
        }

        //try compiling as we insert rows
        this.compileAndAdd(this.ePinnedColsContainer, this.rowsInPinnedContainer, rowIndex, ePinnedRow, newChildScope);
        this.compileAndAdd(this.eBodyContainer, this.rowsInBodyContainer, rowIndex, eMainRow, newChildScope);
    };

    RowRenderer.prototype.createChildScopeOrNull = function(data, rowIndex) {
        if (this.gridOptionsWrapper.isAngularCompile()) {
            var newChildScope = this.$scope.$new();
            this.childScopesForRows[rowIndex] = newChildScope;
            newChildScope.rowData = data;
            return newChildScope;
        } else {
            return null;
        }
    };

    RowRenderer.prototype.compileAndAdd = function(container, map, rowIndex, element, scope) {
        if (scope) {
            var eElementCompiled = this.$compile(element)(scope);
            container.appendChild(eElementCompiled[0]);
            map[rowIndex] = eElementCompiled[0];
        } else {
            container.appendChild(element);
            map[rowIndex] = element;
        }
    };

    RowRenderer.prototype.createCellFromColDef = function(colDef, value, data, rowIndex, colIndex, pinnedColumnCount, eMainRow, ePinnedRow, $childScope) {
        var eGridCell = this.createCell(colDef, value, data, rowIndex, colIndex, $childScope);

        if (colIndex>=pinnedColumnCount) {
            eMainRow.appendChild(eGridCell);
        } else {
            ePinnedRow.appendChild(eGridCell);
        }
    };

    RowRenderer.prototype.createRowContainer = function(rowIndex, row, groupRow) {
        var eRow = document.createElement("div");
        var classesList = ["ag-row"];
        classesList.push(rowIndex%2==0 ? "ag-row-even" : "ag-row-odd");
        if (this.gridOptions.selectedRows.indexOf(row)>=0) {
            classesList.push("ag-row-selected");
        }
        var classes = classesList.join(" ");

        eRow.className = classes;

        eRow.setAttribute("row", rowIndex);

        eRow.style.top = (this.gridOptionsWrapper.getRowHeight() * rowIndex) + "px";
        eRow.style.height = (this.gridOptionsWrapper.getRowHeight()) + "px";

        if (!groupRow) {
            var _this = this;
            eRow.addEventListener("click", function(event) {
                _this.angularGrid.onRowClicked(event, Number(this.getAttribute("row")))
            });
        }

        return eRow;
    };

    RowRenderer.prototype.createGroupElement = function(data, firstColDef, useEntireRow, padding) {
        var eGridGroupRow = document.createElement('div');
        if (useEntireRow) {
            eGridGroupRow.className = 'ag-group-cell';
            //eGridGroupRow.style.width = '500px';
        } else {
            eGridGroupRow.className = 'ag-cell cell-col-'+0;
        }

        if (!padding) {
            var eSvg = svgFactory.createGroupSvg(data.expanded);
            eGridGroupRow.appendChild(eSvg);
        }

        //if renderer provided, use it
        if (this.gridOptions.groupInnerCellRenderer) {
            var resultFromRenderer = this.gridOptions.groupInnerCellRenderer(data, padding);
            if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
                //a dom node or element was returned, so add child
                eGridGroupRow.appendChild(resultFromRenderer);
            } else {
                //otherwise assume it was html, so just insert
                var eTextSpan = document.createElement('span');
                eTextSpan.innerHTML = resultFromRenderer;
                eGridGroupRow.appendChild(eTextSpan);
            }
        } else {
            //otherwise default is display the key along with the child count
            if (!padding) { //only do it if not padding - if we are padding, we display blank row
                var eText = document.createTextNode(" " + data.key + " (" + data.allChildrenCount + ")");
                eGridGroupRow.appendChild(eText);
            }
        }

        if (!useEntireRow) {
            eGridGroupRow.style.width = utils.formatWidth(firstColDef.actualWidth);
        }

        //indent with the group level
        if (!padding) {
            eGridGroupRow.style.paddingLeft = ((data.level + 1) * 10) + "px";
        }

        var _this = this;
        eGridGroupRow.addEventListener("click", function(event) {
            data.expanded = !data.expanded;
            _this.angularGrid.updateModelAndRefresh(constants.STEP_MAP);
        });

        return eGridGroupRow;
    };

    RowRenderer.prototype.createCell = function(colDef, value, data, rowIndex, colIndex, $childScope) {
        var that = this;
        var eGridCell = document.createElement("div");
        eGridCell.className = "ag-cell cell-col-"+colIndex;

        if (colDef.cellRenderer) {
            var resultFromRenderer = colDef.cellRenderer(value, data, colDef, $childScope);
            if (utils.isNode(resultFromRenderer) || utils.isElement(resultFromRenderer)) {
                //a dom node or element was returned, so add child
                eGridCell.appendChild(resultFromRenderer);
            } else {
                //otherwise assume it was html, so just insert
                eGridCell.innerHTML = resultFromRenderer;
            }
        } else {
            //if we insert undefined, then it displays as the string 'undefined', ugly!
            if (value!==undefined) {
                eGridCell.innerText = value;
            }
        }

        if (colDef.cellCss) {
            Object.keys(colDef.cellCss).forEach(function(key) {
                eGridCell.style[key] = colDef.cellCss[key];
            });
        }

        if (colDef.cellCssFunc) {
            var cssObjFromFunc = colDef.cellCssFunc(value, data, colDef, $childScope);
            if (cssObjFromFunc) {
                Object.keys(cssObjFromFunc).forEach(function(key) {
                    eGridCell.style[key] = cssObjFromFunc[key];
                });
            }
        }

        eGridCell.addEventListener("click", function(event) {
            if (that.gridOptionsWrapper.getCellClicked()) {
                that.gridOptionsWrapper.getCellClicked()(data, colDef, event);
            }
        });

        eGridCell.style.width = utils.formatWidth(colDef.actualWidth);

        return eGridCell;
    };

    return RowRenderer;

});
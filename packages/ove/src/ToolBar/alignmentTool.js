import React from "react";
import { Icon, Button, Intent } from "@blueprintjs/core";
import {
  FileUploadField,
  TextareaField,
  EditableTextField,
  CheckboxField,
  wrapDialog
} from "@teselagen/ui";
import { reduxForm, FieldArray } from "redux-form";
import { anyToJson } from "@teselagen/bio-parsers";
import { flatMap } from "lodash-es";
import uniqid from "shortid";
import biomsa from "biomsa";
import { getReverseComplementSequenceAndAnnotations } from "@teselagen/sequence-utils";

import ToolbarItem from "./ToolbarItem";
import { connectToEditor } from "../withEditorProps";
import withEditorProps from "../withEditorProps";
import { showDialog } from "../GlobalDialogUtils";
import { compose } from "recompose";

/**
 * Reverse complements chromatogram data
 * @param {Object} sequenceData - The sequence data to reverse complement
 * @returns {Object} - The reverse complemented sequence data
 */
function reverseComplementSequenceData(sequenceData) {
  if (!sequenceData) return null;

  const { cTrace, baseTraces, basePos, baseCalls, qualNums } = sequenceData;

  const traceLength = cTrace ? cTrace.length : 0;

  // Helper to reverse and complement base calls
  const reverseComplementBaseCalls = baseCalls => {
    if (!baseCalls) return [];

    const complementMap = {
      A: "T",
      T: "A",
      G: "C",
      C: "G",
      N: "N",
      R: "Y",
      Y: "R",
      M: "K",
      K: "M",
      S: "S",
      W: "W",
      H: "D",
      D: "H",
      B: "V",
      V: "B",
      X: "X",
      Z: "Z"
    };

    return baseCalls
      .map(base => {
        const upperBase = base.toUpperCase();
        return complementMap[upperBase] || base;
      })
      .reverse();
  };

  // Helper function to process trace data, switching complementary traces and reversing
  const processTraceData = traceData => {
    if (!traceData) return {};

    // Extract only the needed properties, preserving others
    const { aTrace, tTrace, gTrace, cTrace, ...otherProps } = traceData;

    return {
      ...otherProps,
      // Switch cTrace and gTrace, then reverse
      cTrace: gTrace ? [...gTrace].reverse() : [],
      gTrace: cTrace ? [...cTrace].reverse() : [],

      // Switch aTrace and tTrace, then reverse
      aTrace: tTrace ? [...tTrace].reverse() : [],
      tTrace: aTrace ? [...aTrace].reverse() : []
    };
  };

  const newSequenceData = {
    ...processTraceData(sequenceData),

    // For basePos: subtract from traceLength, multiply by -1, and reverse
    basePos: basePos
      ? basePos.map(pos => -1 * (pos - traceLength)).reverse()
      : [],

    // Reverse complement base calls
    baseCalls: reverseComplementBaseCalls(baseCalls),

    // Reverse qual nums
    qualNums: qualNums ? [...qualNums].reverse() : [],

    // Process baseTraces in reverse order
    baseTraces: baseTraces
      ? baseTraces.map(trace => processTraceData(trace)).reverse()
      : []
  };

  return newSequenceData;
}

export default connectToEditor(({ readOnly, toolBar = {} }) => {
  return {
    readOnly: readOnly,
    isOpen: toolBar.openItem === "alignmentTool"
  };
})(({ toolbarItemProps, isOpen }) => {
  return (
    <ToolbarItem
      {...{
        Icon: <Icon data-test="alignmentTool" icon="align-left" />,
        // toggled: alignmentTool.isOpen,
        renderIconAbove: isOpen,
        // onIconClick: toggleFindTool,
        Dropdown: ConnectedAlignmentToolDropdown,
        onIconClick: "toggleDropdown",
        noDropdownIcon: true,
        tooltip: isOpen ? "Hide Alignment Tool" : "Align to This Sequence",
        ...toolbarItemProps
      }}
    />
  );
});

class AlignmentToolDropdown extends React.Component {
  render() {
    const {
      savedAlignments = [],
      hasSavedAlignments,
      toggleDropdown,
      sequenceData
    } = this.props;
    return (
      <div>
        <Button
          intent={Intent.PRIMARY}
          onClick={() => {
            toggleDropdown();
            showDialog({
              dialogType: "AlignmentToolDialog",
              props: {
                createNewAlignment: this.props.createNewAlignment,
                upsertAlignmentRun: this.props.upsertAlignmentRun,
                initialValues: {
                  addedSequences: [{ ...sequenceData, isTemplate: true }]
                }
              }
            });
          }}
        >
          Create New Alignment
        </Button>
        <br></br>
        <div className="vespacer" />
        {hasSavedAlignments && (
          <div>
            <h6>Saved Alignments:</h6>
            {!savedAlignments.length && (
              <div style={{ fontStyle: "italic" }}> No Alignments</div>
            )}
            {savedAlignments.map((savedAlignment, i) => {
              return <div key={i}>Saved Alignment {i}</div>;
            })}
          </div>
        )}
      </div>
    );
  }
}
const ConnectedAlignmentToolDropdown = withEditorProps(AlignmentToolDropdown);

class AlignmentTool extends React.Component {
  state = {
    currentSequenceNames: []
  };

  // Helper function to create unique sequence names with numeric suffixes
  getUniqueSequenceName = (name, existingNames = []) => {
    // If name doesn't exist in the array, return it as is
    if (!existingNames.includes(name)) {
      return name;
    }

    // Find available numeric suffix
    let counter = 1;
    let newName;

    do {
      newName = `${name}_${counter}`;
      counter++;
    } while (existingNames.includes(newName));

    return newName;
  };

  // Update state when sequences change
  updateCurrentSequenceNames = sequences => {
    const names = (sequences || []).map(seq => seq?.name || "").filter(Boolean);
    this.setState({ currentSequenceNames: names });
  };

  sendSelectedDataToBackendForAlignment = async values => {
    const { addedSequences, revcomFlags = [] } = values;
    const {
      hideModal,
      /* onAlignmentSuccess, */ createNewAlignment,
      // createNewMismatchesList,
      upsertAlignmentRun
    } = this.props;

    // No need to reorder - first sequence is always the template
    const seqsToAlign = addedSequences.map((seq, index) => {
      // Check if the revcom checkbox is checked for this sequence
      const shouldReverseComplement = !!revcomFlags[index];

      // If the sequence is not being reverse complemented, return it as is
      if (!shouldReverseComplement) {
        return seq;
      }

      // Only keep a subset of keys that we can easily reverse complement
      const keysToKeep = [
        "chromatogramData",
        "circular",
        "features",
        "id",
        "isDNA",
        "isDoubleStrandedDNA",
        "isProtein",
        "isTemplate",
        "name",
        "orfs",
        "revComplemented",
        "sequence",
        "translations",
        "type"
      ];

      // Create a copy of the sequence with only the keys we need
      const filteredSeq = Object.fromEntries(
        Object.entries(seq).filter(([key]) => keysToKeep.includes(key))
      );
      // Specifically copy the features, translations, and orfs objects
      if (seq.features) {
        filteredSeq.features = { ...seq.features };
      }
      if (seq.translations) {
        filteredSeq.translations = { ...seq.translations };
      }
      if (seq.orfs) {
        filteredSeq.orfs = [...seq.orfs];
      }

      // Reverse complement the sequence and annotations
      const processedSeq =
        getReverseComplementSequenceAndAnnotations(filteredSeq);

      // Transform chromatogram data if it exists
      if (processedSeq.chromatogramData) {
        processedSeq.chromatogramData = reverseComplementSequenceData(
          processedSeq.chromatogramData
        );
      }

      // Reverse complement features (adjust start, end, forward, strand, optionally locations)
      if (seq.features && Object.keys(seq.features).length) {
        processedSeq.features = Object.fromEntries(
          Object.entries(seq.features).map(([id, feature]) => [
            id,
            {
              ...feature,
              start: processedSeq.sequence.length - feature.end,
              end: processedSeq.sequence.length - feature.start,
              forward: !feature.forward,
              strand: feature.strand === 1 ? -1 : 1,
              locations:
                feature.locations?.map(loc => ({
                  ...loc,
                  start: processedSeq.sequence.length - loc.end,
                  end: processedSeq.sequence.length - loc.start
                })) || []
            }
          ])
        );
      } else {
        processedSeq.features = {};
      }

      // Reverse complement translations (dict like features)
      if (seq.translations && Object.keys(seq.translations).length) {
        processedSeq.translations = Object.fromEntries(
          Object.entries(seq.translations).map(([id, translation]) => [
            id,
            {
              ...translation,
              start: processedSeq.sequence.length - translation.end,
              end: processedSeq.sequence.length - translation.start,
              forward: !translation.forward,
              strand: translation.strand === 1 ? -1 : 1,
              aminoAcids: translation.aminoAcids
                ? translation.aminoAcids
                    .map(aa => ({
                      ...aa,
                      sequenceIndex:
                        processedSeq.sequence.length - aa.sequenceIndex,
                      aminoAcidIndex: aa.aminoAcidIndex,
                      codonRange: aa.codonRange
                        ? {
                            start:
                              processedSeq.sequence.length - aa.codonRange.end,
                            end:
                              processedSeq.sequence.length - aa.codonRange.start
                          }
                        : aa.codonRange
                    }))
                    .reverse()
                : []
            }
          ])
        );
      }

      // Reverse complement orfs (adjust start, end, forward, frame, internalStartCodonIndices)
      if (processedSeq.orfs && processedSeq.orfs.length) {
        processedSeq.orfs = processedSeq.orfs.map(orf => {
          return {
            ...orf,
            start: processedSeq.sequence.length - orf.end,
            end: processedSeq.sequence.length - orf.start,
            forward: !orf.forward,
            strand: orf.strand === 1 ? -1 : 1,
            frame: ((processedSeq.sequence.length - orf.start) % 3) + 1,
            internalStartCodonIndices:
              orf.internalStartCodonIndices
                ?.map(index => processedSeq.sequence.length - index)
                ?.reverse() || []
          };
        });
      } else {
        processedSeq.orfs = [];
      }

      // Mark that this sequence has been reverse complemented
      processedSeq.revComplemented = true;

      return processedSeq;
    });

    hideModal();
    const alignmentId = uniqid();
    createNewAlignment({
      id: alignmentId,
      name: seqsToAlign[0].name + " Alignment"
    });
    //set the alignment to loading
    upsertAlignmentRun({
      id: alignmentId,
      loading: true
    });

    const unAlignedSequences = seqsToAlign.map(({ sequence }) => sequence);
    const alignedSequencesNoInfo = await biomsa.align(unAlignedSequences);
    const alignedSequences = alignedSequencesNoInfo.map((sequence, index) => ({
      sequence,
      name: seqsToAlign[index].name,
      id: seqsToAlign[index].id,
      ...(seqsToAlign[index].revComplemented && { revComplemented: true })
    }));
    if (!alignedSequences)
      window.toastr.error("Error running sequence alignment!");
    const dataToUpsert = {
      id: alignmentId,
      name: "Alignment",
      alignmentType: "Multiple Sequence Alignment",
      alignmentTracks:
        alignedSequences &&
        alignedSequences.map(alignmentData => {
          const originalSeq = seqsToAlign.find(
            seq => seq.name === alignmentData.name
          );
          return {
            sequenceData: originalSeq,
            alignmentData,
            ...(originalSeq.chromatogramData && {
              chromatogramData: originalSeq.chromatogramData
            })
          };
        })
    };
    upsertAlignmentRun(dataToUpsert);
  };

  handleFileUpload = (files, onChange, existingNames = []) => {
    const { array } = this.props;
    // Keep a local cache of sequence names we've added in this upload batch
    const addedNames = new Set();

    // Create a set from the array of existing names
    const existingNamesSet = new Set(existingNames);

    flatMap(files, async file => {
      const results = await anyToJson(file.originalFileObj, {
        fileName: file.name,
        acceptParts: true
      });

      return results.forEach(result => {
        if (result.success) {
          // Get original name
          let uniqueName = result.parsedSequence.name;
          let counter = 1;

          // Check against both existing names and this batch's names
          while (
            existingNamesSet.has(uniqueName) ||
            addedNames.has(uniqueName)
          ) {
            uniqueName = `${result.parsedSequence.name}_${counter}`;
            counter++;
          }

          // Remember this name for future checks in this batch
          addedNames.add(uniqueName);

          // Add the sequence with unique name
          array.push("addedSequences", {
            ...result.parsedSequence,
            name: uniqueName,
            id: result.parsedSequence.id || uniqid()
          });
        } else {
          return window.toastr.warning("Error parsing file: ", file.name);
        }
      });
    });
    onChange([]);
  };
  renderAddSequence = ({ fields }) => {
    const { handleSubmit } = this.props;
    const sequencesToAlign = fields.getAll() || [];

    // Update state with current sequences when they change
    if (sequencesToAlign?.length > 0) {
      this.updateCurrentSequenceNames(sequencesToAlign);
    }

    // Store fields reference for use in file upload
    this.fieldsInstance = fields;

    return (
      <div>
        <h6>Or enter sequences in plain text format</h6>
        <div>
          <AddYourOwnSeqForm
            addSeq={newSeq => {
              const currentSequences = fields.getAll() || [];
              // Extract just the names from the sequence objects
              const existingNames = currentSequences.map(seq => seq.name);

              const uniqueName = this.getUniqueSequenceName(
                newSeq.name,
                existingNames
              );

              fields.push({
                ...newSeq,
                name: uniqueName,
                id: uniqid()
              });
            }}
          />
          <h6 style={{ marginTop: 15 }}>Sequences To Align: </h6>
          {!fields.getAll() && <div>No sequences added yet.</div>}

          <div
            style={{ maxHeight: 180, overflowY: "auto" }}
            className="veAlignmentToolSelectedSequenceList"
          >
            {sequencesToAlign.map((addedSeq, index) => {
              return (
                <div
                  style={{
                    borderBottom: "1px solid lightgrey",
                    paddingBottom: 4,
                    marginBottom: 4,
                    width: "100%",
                    justifyContent: "space-between",
                    alignItems: "center",
                    display: "flex"
                  }}
                  key={index}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {addedSeq.name}{" "}
                    <span style={{ fontSize: 10 }}>
                      {" "}
                      ({addedSeq.sequence.length} bps)
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px"
                    }}
                  >
                    <CheckboxField
                      name={`revcomFlags[${index}]`}
                      label="RC"
                      onClick={e => e.stopPropagation()}
                      noMarginBottom
                    />
                    <Button
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        fields.remove(index);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <br />

          <Button
            style={{ marginTop: 15, float: "right" }}
            intent={Intent.PRIMARY}
            disabled={sequencesToAlign.length < 2}
            onClick={handleSubmit(this.sendSelectedDataToBackendForAlignment)}
          >
            Create alignment
          </Button>
        </div>
      </div>
    );
  };

  render() {
    const { selectFromSequenceLibraryHook } = this.props;
    return (
      <div style={{ padding: 20 }} className="veAlignmentTool">
        <h6>Upload files you'd like to align (.ab1, .fasta, .gb) </h6>
        <FileUploadField
          name="alignmentToolSequenceUpload"
          style={{ maxWidth: 400 }}
          beforeUpload={(files, onChange) => {
            // Get current sequences directly from fields if possible
            let currentSequences = [];
            if (this.fieldsInstance?.getAll) {
              currentSequences = this.fieldsInstance.getAll() || [];
            }

            // Fallback to state if we couldn't get fields
            const currentSequenceNames =
              currentSequences.length > 0
                ? currentSequences.map(seq => seq?.name || "").filter(Boolean)
                : this.state.currentSequenceNames;

            this.handleFileUpload(files, onChange, currentSequenceNames);
          }}
        />
        {selectFromSequenceLibraryHook && (
          <h6>Or Select from your sequence library </h6>
        )}

        <FieldArray name="addedSequences" component={this.renderAddSequence} />
      </div>
    );
  }
}

export const AlignmentToolDialog = compose(
  wrapDialog({ title: "Create New Alignment" }),
  reduxForm({
    form: "veAlignmentTool"
  })
)(AlignmentTool);

const AddYourOwnSeqForm = reduxForm({
  form: "AddYourOwnSeqForm",
  validate: ({ name, sequence }) => {
    const errors = {};
    if (!name) {
      errors.name = "Required";
    }
    if (!sequence) {
      errors.sequence = "Required";
    }
    return errors;
  }
})(({ pristine, error, handleSubmit, reset, addSeq }) => {
  return (
    <form
      onSubmit={handleSubmit(vals => {
        reset();
        addSeq(vals);
      })}
    >
      <EditableTextField
        style={{ maxWidth: 200 }}
        placeholder="Untitled Sequence"
        name="name"
      />
      <TextareaField
        style={{ maxWidth: 400 }}
        placeholder="AGTTGAGC"
        name="sequence"
      />
      <Button disabled={pristine || error} type="submit">
        Add
      </Button>
    </form>
  );
});

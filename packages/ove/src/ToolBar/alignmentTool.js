import React from "react";
import { Icon, Button, Intent, Classes } from "@blueprintjs/core";
import {
  FileUploadField,
  TextareaField,
  EditableTextField,
  CheckboxField,
  RadioGroupField,
  wrapDialog
} from "@teselagen/ui";
import { reduxForm, FieldArray } from "redux-form";
import { anyToJson } from "@teselagen/bio-parsers";
import { flatMap } from "lodash-es";
import uniqid from "shortid";
import classNames from "classnames";
import biomsa from "biomsa";
import { getReverseComplementSequenceString } from "@teselagen/sequence-utils";

import ToolbarItem from "./ToolbarItem";
import { connectToEditor } from "../withEditorProps";
import withEditorProps from "../withEditorProps";
import { showDialog } from "../GlobalDialogUtils";
import { compose } from "recompose";
import { array_move } from "./array_move";

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
    templateSeqIndex: 0
  };
  sendSelectedDataToBackendForAlignment = async values => {
    const { addedSequences, revcomFlags = [] } = values;
    const {
      hideModal,
      /* onAlignmentSuccess, */ createNewAlignment,
      // createNewMismatchesList,
      upsertAlignmentRun
    } = this.props;
    const { templateSeqIndex } = this.state;

    // Create a mapping of original indices to revcomFlags before we reorder
    const revcomFlagsMap = addedSequences.map((seq, i) => ({
      id: seq.id || `seq-${i}`,
      revcom: !!revcomFlags[i]
    }));

    // Move template sequence to first position
    const addedSequencesToUse = array_move(addedSequences, templateSeqIndex, 0);

    // Process sequences, applying reverse complement if 'revcom' is checked
    const seqsToAlign = addedSequencesToUse.map((seq, index) => {
      // Find the original revcom setting for this sequence
      const seqId =
        seq.id ||
        `seq-${templateSeqIndex === index ? templateSeqIndex : index}`;
      const revcomSetting = revcomFlagsMap.find(item => item.id === seqId);
      const shouldReverseComplement = revcomSetting
        ? revcomSetting.revcom
        : false;

      if (shouldReverseComplement) {
        return {
          ...seq,
          sequence: getReverseComplementSequenceString(seq.sequence),
          revComplemented: true // Mark that this sequence has been reverse complemented
        };
      }
      return seq;
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

  handleFileUpload = (files, onChange) => {
    const { array } = this.props;
    flatMap(files, async file => {
      const results = await anyToJson(file.originalFileObj, {
        fileName: file.name,
        acceptParts: true
      });
      return results.forEach(result => {
        if (result.success) {
          // Add an ID to the sequence for tracking
          array.push("addedSequences", {
            ...result.parsedSequence,
            id: result.parsedSequence.id || uniqid()
          });
        } else {
          return window.toastr.warning("Error parsing file: ", file.name);
        }
      });
    });
    onChange([]);
  };
  renderAddSequence = ({ fields, templateSeqIndex }) => {
    const { handleSubmit } = this.props;

    const sequencesToAlign = fields.getAll() || [];

    return (
      <div>
        <h6>Or enter sequences in plain text format</h6>
        <div>
          <AddYourOwnSeqForm
            addSeq={newSeq => {
              fields.push({
                ...newSeq,
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
                    <RadioGroupField
                      name="templateSequence"
                      value={templateSeqIndex === index ? index.toString() : ""}
                      onChange={() => {
                        this.setState({
                          templateSeqIndex: index
                        });
                      }}
                      options={[{ value: index.toString(), label: "" }]}
                      inline
                      style={{ margin: 0, marginRight: "5px" }}
                    />
                    {addedSeq.name}{" "}
                    <span style={{ fontSize: 10 }}>
                      {" "}
                      ({addedSeq.sequence.length} bps)
                    </span>
                    {index === templateSeqIndex && (
                      <div
                        className={classNames(
                          Classes.TAG,
                          Classes.ROUND,
                          Classes.INTENT_PRIMARY
                        )}
                      >
                        template
                      </div>
                    )}
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
                    />
                    <Button
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        fields.remove(index);
                        if (index === templateSeqIndex) {
                          this.setState({ templateSeqIndex: 0 });
                        }
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
    const { templateSeqIndex } = this.state;
    return (
      <div style={{ padding: 20 }} className="veAlignmentTool">
        <h6>Upload files you'd like to align (.ab1, .fasta, .gb) </h6>
        <FileUploadField
          name="alignmentToolSequenceUpload"
          style={{ maxWidth: 400 }}
          beforeUpload={this.handleFileUpload}
        />
        {selectFromSequenceLibraryHook && (
          <h6>Or Select from your sequence library </h6>
        )}

        <FieldArray
          name="addedSequences"
          templateSeqIndex={templateSeqIndex}
          component={this.renderAddSequence}
        />
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

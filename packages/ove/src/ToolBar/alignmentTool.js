import React from "react";
import { Icon, Button, Intent, Classes, Callout } from "@blueprintjs/core";
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
import { cloneDeep } from "lodash-es";
import classNames from "classnames";
import * as biomsa from "biomsa";

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
    const {
      addedSequences,
    } = values;
    const {
      hideModal,
      /* onAlignmentSuccess, */ createNewAlignment,
      // createNewMismatchesList,
      upsertAlignmentRun
    } = this.props;
    const { templateSeqIndex } = this.state;
    const addedSequencesToUse = array_move(addedSequences, templateSeqIndex, 0);

    let seqsToAlign;
    seqsToAlign = addedSequencesToUse;

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
      id: seqsToAlign[index].id
    }));
    if (!alignedSequences)
      window.toastr.error("Error running sequence alignment!");
    const dataToUpsert = {
      id: alignmentId,
      alignmentTracks: alignedSequences && alignedSequences.map((alignmentData) => {
        const originalSeq = seqsToAlign.find(seq => seq.name === alignmentData.name);
        return {
          sequenceData: originalSeq,
          alignmentData,
          ...(originalSeq.chromatogramData && { chromatogramData: originalSeq.chromatogramData })
        };
      })
    };
    upsertAlignmentRun2(dataToUpsert);
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
          array.push("addedSequences", result.parsedSequence);
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
              fields.push(newSeq);
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
                  onClick={() => {
                    this.setState({
                      templateSeqIndex: index
                    });
                  }}
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
                  <div>
                    {addedSeq.name}{" "}
                    <span style={{ fontSize: 10 }}>
                      {" "}
                      ({addedSeq.sequence.length} bps)
                    </span>
                  </div>
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

function mottTrim(qualNums) {
  if (!qualNums) return;
  let startPos = 0;
  let endPos = 0;
  const totalScoreInfo = [];
  let score = 0;
  let totalScore = 0;
  const cutoff = 0.05;
  for (let i = 0; i < qualNums.length; i++) {
    // low-quality bases have high error probabilities, so may have a negative base score
    score = cutoff - Math.pow(10, qualNums[i] / -10);
    totalScore += score;
    totalScoreInfo.push(totalScore);
    // score = score + cutoff - Math.pow(10, qualNums[i] / -10);
    // if (totalScore < 0) {
    //   tempStart = i;
    // }
    // if (i - tempStart > endPos - startPos) {
    //   startPos = tempStart;
    //   endPos = i;
    // }
    if (totalScore < 0) {
      totalScore = 0;
    }
  }
  const firstPositiveValue = totalScoreInfo.find(e => {
    return e > 0;
  });
  startPos = totalScoreInfo.indexOf(firstPositiveValue);
  const highestValue = Math.max(...totalScoreInfo);
  endPos = totalScoreInfo.lastIndexOf(highestValue);
  return {
    suggestedTrimStart: startPos,
    suggestedTrimEnd: endPos
  };
}

/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import styled from "@emotion/styled/macro"
import React from "react"

import { colors } from "../styles/variables"

interface Props {
  onClick: () => void
  loading: boolean
}

const Button = styled.div`
  padding: 0.3em;
  border-radius: 10%;
  cursor: pointer;
  :active {
    opacity: 0.5;
  }
`

const Icon = styled.i`
  color: ${colors.gardenGray};
  font-size: 1.25rem;
  :hover {
    color: ${colors.gardenPink}
  }
  :active {
    opacity: 0.5;
  }
`

const IconLoading = styled(Icon)`
  animation spin 0.5s infinite linear;
  @keyframes spin {
    from {
      transform:rotate(0deg);
    }
    to {
      transform:rotate(360deg);
    }
  }
`

export const RefreshButton: React.FC<Props> = ({ loading, onClick }) => {
  const IconComp = loading ? IconLoading : Icon

  return (
    <Button onClick={onClick}>
      <IconComp className={"fas fa-redo-alt"} />
    </Button>
  )
}

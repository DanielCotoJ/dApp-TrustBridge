/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { toast } from "@/hooks/toast.hook";
import { initializeEscrow } from "@/components/modules/escrow/services/initialize-escrow.service";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  useGlobalAuthenticationStore,
  useGlobalBoundedStore,
} from "@/core/store/data";
import { useEscrowBoundedStore } from "../store/ui";
import { useGlobalUIBoundedStore } from "@/core/store/ui";
import { GetFormSchema } from "../schema/initialize-escrow.schema";
import { Trustline } from "@/@types/trustline.entity";

export const useInitializeEscrow = () => {
  const [showSelect, setShowSelect] = useState({
    approver: false,
    serviceProvider: false,
    platformAddress: false,
    releaseSigner: false,
    disputeResolver: false,
  });

  const { address } = useGlobalAuthenticationStore();
  const addEscrow = useGlobalBoundedStore((state) => state.addEscrow);
  const loggedUser = useGlobalAuthenticationStore((state) => state.loggedUser);
  const setIsLoading = useGlobalUIBoundedStore((state) => state.setIsLoading);
  const formData = useEscrowBoundedStore((state) => state.formData);
  const setFormData = useEscrowBoundedStore((state) => state.setFormData);
  const resetForm = useEscrowBoundedStore((state) => state.resetForm);
  const setCurrentStep = useEscrowBoundedStore((state) => state.setCurrentStep);
  const router = useRouter();
  const setIsSuccessDialogOpen = useEscrowBoundedStore(
    (state) => state.setIsSuccessDialogOpen,
  );
  const resetSteps = useGlobalUIBoundedStore((state) => state.resetSteps);
  const setRecentEscrow = useGlobalBoundedStore(
    (state) => state.setRecentEscrow,
  );
  const getAllUsers = useGlobalAuthenticationStore(
    (state) => state.getAllUsers,
  );
  const users = useGlobalAuthenticationStore((state) => state.users);
  const getAllTrustlines = useGlobalBoundedStore(
    (state) => state.getAllTrustlines,
  );
  const trustlines = useGlobalBoundedStore((state) => state.trustlines);
  const formSchema = GetFormSchema();

  useEffect(() => {
    getAllUsers();
    getAllTrustlines();
  }, [getAllUsers, getAllTrustlines]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      trustline: "",
      approver: "",
      engagementId: "",
      title: "",
      description: "",
      serviceProvider: "",
      platformAddress: "",
      platformFee: "",
      amount: "",
      releaseSigner: "",
      disputeResolver: "",
      milestones: [{ description: "" }],
    },
    mode: "onChange",
  });

  // Load stored form data when component mounts
  useEffect(() => {
    if (formData) {
      Object.keys(formData).forEach((key) => {
        form.setValue(key as any, formData[key as keyof typeof formData]);
      });
    }
  }, [formData, form]);

  const milestones = form.watch("milestones");
  const isAnyMilestoneEmpty = milestones.some(
    (milestone) => milestone.description === "",
  );

  const handleAddMilestone = () => {
    const currentMilestones = form.getValues("milestones");
    const updatedMilestones = [...currentMilestones, { description: "" }];
    form.setValue("milestones", updatedMilestones);
    setFormData({ milestones: updatedMilestones });
  };

  const handleRemoveMilestone = (index: number) => {
    const currentMilestones = form.getValues("milestones");
    const updatedMilestones = currentMilestones.filter((_, i) => i !== index);
    form.setValue("milestones", updatedMilestones);
    setFormData({ milestones: updatedMilestones });
  };

  const onSubmit = async (payload: z.infer<typeof formSchema>) => {
    console.log("Submitting form payload:", payload);
    setFormData(payload);
    setIsLoading(true);
    setIsSuccessDialogOpen(false);

    const trustlineObject = trustlines.find(
      (tl) => tl.trustline === payload.trustline,
    );

    console.log("Selected trustlineObject:", trustlineObject);

    try {
      const platformFeeDecimal = Number(payload.platformFee);

      const data = await initializeEscrow(
        {
          ...payload,
          platformFee: platformFeeDecimal.toString(),
          issuer: address,
          trustlineDecimals: trustlineObject?.trustlineDecimals,
        },
        address,
      );

      console.log("Response from initializeEscrow:", data);

      if (data.status === "SUCCESS" || data.status === 201) {
        setIsSuccessDialogOpen(true);

        if (loggedUser?.saveEscrow) {
          console.log("Calling addEscrow with:", {
            escrow: {
              ...data.escrow,
              platformFee: platformFeeDecimal.toString(),
              trustline: trustlineObject,
            },
            contract_id: data.contract_id,
          });

          await addEscrow(
            {
              ...data.escrow,
              platformFee: platformFeeDecimal.toString(),
              trustline: trustlineObject,
            },
            address,
            data.contract_id,
          );
          console.log("addEscrow completed successfully.");
        } else {
          console.warn("loggedUser?.saveEscrow is false, skipping addEscrow");
        }

        const recent = { ...data.escrow, contractId: data.contract_id };
        console.log("Setting recent escrow:", recent);
        setRecentEscrow(recent);

        resetSteps();
        setCurrentStep(1);
        form.reset();
        resetForm();
        router.push("/dashboard/loans");
        setIsLoading(false);
      } else {
        console.error("initializeEscrow failed:", data);
        resetSteps();
        setCurrentStep(1);
        setIsLoading(false);
        setIsSuccessDialogOpen(false);
        toast({
          title: "Error",
          description: data.message || "An error occurred",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Exception during onSubmit:", error);
      setIsLoading(false);
      setIsSuccessDialogOpen(false);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Update store whenever form fields change
  const handleFieldChange = (name: string, value: any) => {
    const currentValues = form.getValues();
    const updatedFormData = {
      ...currentValues,
      [name]: value,
    };
    setFormData(updatedFormData);
    form.setValue(name as any, value, { shouldValidate: true });
  };

  const userOptions = useMemo(() => {
    const options = users.map((user) => ({
      value: user.address,
      label: `${user.firstName} ${user.lastName}`,
    }));

    return [{ value: "", label: "Select an User" }, ...options];
  }, [users]);

  const trustlineOptions = useMemo(() => {
    const options = trustlines.map((trustline: Trustline) => ({
      value: trustline.trustline,
      label: trustline.name,
    }));

    return [{ value: "", label: "Select a Trustline" }, ...options];
  }, [trustlines]);

  const toggleField = (field: string, value: boolean) => {
    setShowSelect((prev) => ({ ...prev, [field]: value }));
  };

  return {
    form,
    milestones,
    onSubmit,
    handleAddMilestone,
    handleRemoveMilestone,
    handleFieldChange,
    userOptions,
    trustlineOptions,
    showSelect,
    toggleField,
    isAnyMilestoneEmpty,
  };
};
